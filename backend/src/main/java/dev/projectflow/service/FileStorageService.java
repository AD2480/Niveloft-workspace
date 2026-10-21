package dev.projectflow.service;

import java.util.List;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionSynchronization;
import dev.projectflow.config.AppProperties;
import dev.projectflow.domain.Project;
import dev.projectflow.domain.StoredFile;
import dev.projectflow.domain.User;
import dev.projectflow.repository.StoredFileRepository;
import dev.projectflow.web.error.ApiException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Clock;
import java.time.Instant;
import java.util.Collection;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.PathResource;
import org.springframework.core.io.Resource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * Stores evidence files on local disk under random keys (never the user's file name),
 * outside any web root. Access is checked by the caller before {@link #open}.
 */
@Service
public class FileStorageService {

    private static final Logger log = LoggerFactory.getLogger(FileStorageService.class);
    public static final long MAX_BYTES = 10L * 1024 * 1024;
    /** Only these types are shown inline (image previews); everything else downloads. */
    public static final Set<String> INLINE_TYPES = UploadCheck.INLINE_TYPES;

    private final Path root;
    private final StoredFileRepository files;
    private final Clock clock;
    private final dev.projectflow.config.LaunchProperties.Uploads uploads;
    private final Set<String> allowed;
    private final dev.projectflow.ops.OpsSwitches switches;
    private final dev.projectflow.ops.AuditLog audit;

    public FileStorageService(AppProperties props, StoredFileRepository files, Clock clock, dev.projectflow.config.LaunchProperties launch,
                              dev.projectflow.ops.OpsSwitches switches, dev.projectflow.ops.AuditLog audit) throws IOException {
        this.root = Path.of(props.storage().directory()).toAbsolutePath().normalize();
        Files.createDirectories(root);
        this.files = files;
        this.clock = clock;
        this.uploads = (launch == null ? dev.projectflow.config.LaunchProperties.defaults() : launch).uploadsOrDefault();
        this.allowed = uploads.extensions();
        this.switches = switches;
        this.audit = audit;
    }

    /**
     * Stores an upload: the type must be on the allowlist and its contents must match it, and with
     * UPLOAD_SCAN=clamav it must scan clean. The bytes are written under a random name first and only
     * renamed into place once every check passed, so nothing unchecked is ever served.
     */
    public StoredFile store(MultipartFile upload, Project project, User uploader) {
        if (switches != null) switches.require("uploads");
        if (upload.isEmpty()) throw ApiException.validation("files", "Empty files can't be attached.");
        if (upload.getSize() > MAX_BYTES) throw ApiException.validation("files", "Each file must be 10 MB or smaller.");
        String name = cleanName(upload.getOriginalFilename());
        String key = UUID.randomUUID().toString();
        Path target = root.resolve(key);
        Path pending = root.resolve(key + ".pending");
        String contentType;
        try {
            try (InputStream in = upload.getInputStream()) {
                Files.copy(in, pending, StandardCopyOption.REPLACE_EXISTING);
            }
            byte[] head;
            try (InputStream in = Files.newInputStream(pending)) {
                head = in.readNBytes(16);
            }
            UploadCheck.Verdict v = UploadCheck.check(name, head, allowed);
            if (!v.ok()) throw ApiException.validation("files", v.problem());
            contentType = v.contentType();
            if (uploads.scanWithClamav()) {
                ClamAvScanner.Result r;
                try (InputStream in = Files.newInputStream(pending)) {
                    r = ClamAvScanner.scan(uploads.clamavHostOrDefault(), uploads.clamavPortOrDefault(), uploads.scanTimeout(), in);
                }
                if (r.verdict() == ClamAvScanner.Verdict.INFECTED) {
                    if (audit != null) audit.record(uploader.getId(), project.getId(), "file.rejected", name, dev.projectflow.ops.AuditLog.DENIED, "malware: " + r.detail());
                    log.warn("Upload refused: {} matched {}", key, r.detail());
                    throw ApiException.validation("files", "“" + name + "” was refused: the virus scanner flagged it. If you think it’s safe, share it another way.");
                }
                if (r.verdict() == ClamAvScanner.Verdict.ERROR) {
                    log.warn("Upload refused because the virus scanner couldn't be used: {}", r.detail());
                    throw new ApiException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, dev.projectflow.web.error.ErrorCode.UNAVAILABLE,
                            "Files can’t be checked for viruses right now, so nothing was uploaded. Try again in a few minutes.", null);
                }
            }
            Files.move(pending, target, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new IllegalStateException("Could not store uploaded file", e);
        } finally {
            try {
                Files.deleteIfExists(pending);
            } catch (IOException e) {
                log.warn("Could not remove {}: {}", pending.getFileName(), e.getMessage());
            }
        }
        // If the submission fails after this (validation, a conflict, a timeout), don't leave the file behind.
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    if (status != STATUS_COMMITTED) deleteKeys(List.of(key));
                }
            });
        }
        StoredFile f = new StoredFile();
        f.setProject(project);
        f.setOriginalName(name);
        f.setContentType(contentType);
        f.setSizeBytes(upload.getSize());
        f.setStorageKey(key);
        f.setUploadedBy(uploader);
        f.setCreatedAt(Instant.now(clock));
        return files.save(f);
    }

    public Resource open(StoredFile f) {
        Path path = root.resolve(f.getStorageKey()).normalize();
        if (!path.startsWith(root) || !Files.exists(path)) throw ApiException.notFound("The file is no longer available.");
        return new PathResource(path);
    }

    /** Remove stored bytes (after their rows were deleted). Failures are logged, not fatal. */
    public void deleteKeys(Collection<String> keys) {
        for (String key : keys) {
            try {
                Files.deleteIfExists(root.resolve(key).normalize());
            } catch (IOException e) {
                log.warn("Could not delete stored file {}: {}", key, e.getMessage());
            }
        }
    }

    private static String cleanName(String name) {
        if (name == null || name.isBlank()) return "file";
        String base = name.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1).replaceAll("[\\r\\n\"]", "_");
        return base.length() > 255 ? base.substring(base.length() - 255) : base;
    }
}
