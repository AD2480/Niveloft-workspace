package dev.projectflow.service;

import dev.projectflow.domain.*;
import dev.projectflow.repository.CommentRepository;
import dev.projectflow.repository.UserRepository;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.security.ProjectAccess.TaskAccess;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.error.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Task comments. */
@Service
public class CommentService {

    private final CommentRepository comments;
    private final UserRepository users;
    private final ProjectAccess access;
    private final ActivityService activity;
    private final NotificationService notifications;
    private final MentionNotifier mentions;
    private final DtoMapper mapper;
    private final Clock clock;

    public CommentService(CommentRepository comments, UserRepository users, ProjectAccess access, ActivityService activity,
                          NotificationService notifications, MentionNotifier mentions, DtoMapper mapper, Clock clock) {
        this.comments = comments;
        this.users = users;
        this.mentions = mentions;
        this.access = access;
        this.activity = activity;
        this.notifications = notifications;
        this.mapper = mapper;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<Dto.Comment> list(Long taskId) {
        access.requireTask(taskId);
        return comments.findByTaskIdOrderByCreatedAtAscIdAsc(taskId).stream().map(mapper::comment).toList();
    }

    @Transactional
    public Dto.Comment add(Long taskId, String body) {
        TaskAccess a = access.requireTask(taskId);
        if (!Permissions.comment(a.role())) throw ApiException.forbidden("Viewers cannot comment.");
        User me = users.findById(a.userId()).orElseThrow();
        Task t = a.task();
        Comment c = new Comment();
        c.setTask(t);
        c.setAuthor(me);
        c.setBody(body.trim());
        c.setCreatedAt(Instant.now(clock));
        comments.save(c);
        String key = DtoMapper.taskKey(t);
        activity.log(a.project(), t.getId(), me, ActivityType.COMMENT_ADDED, "commented on " + key);
        String preview = preview(c.getBody());
        // People @mentioned are told they were mentioned instead of being told about a new comment.
        String anchor = "#comment-" + c.getId();
        Set<Long> mentioned = mentions.notifyNew(t, me, c.getBody(), null, Set.of(), MentionNotifier.Where.COMMENT, anchor);
        Set<Long> recipients = new LinkedHashSet<>();
        if (t.getAssignee() != null) recipients.add(t.getAssignee().getId());
        recipients.add(t.getReporter().getId());
        recipients.removeAll(mentioned);
        for (Long r : recipients) {
            notifications.notify(r, me, NotificationType.COMMENT, "New comment", me.getName() + " commented on " + key + ": “" + preview + "”",
                    TaskService.link(t) + anchor, a.project().getId(), null);
        }
        return mapper.comment(c);
    }

    private static String preview(String body) {
        String plain = TextRefs.excerpt(body, null, 400);
        return plain.length() > 80 ? plain.substring(0, 77) + "…" : plain;
    }

    private record Owned(Comment comment, TaskAccess access) {}

    private Owned find(Long commentId) {
        Comment c = comments.findById(commentId).orElseThrow(() -> ApiException.notFound("Comment not found."));
        return new Owned(c, access.requireTask(c.getTask().getId()));
    }

    @Transactional
    public Dto.Comment edit(Long commentId, String body) {
        Owned o = find(commentId);
        if (!o.comment().getAuthor().getId().equals(o.access().userId())) throw ApiException.forbidden("You can only edit your own comments.");
        String before = o.comment().getBody();
        o.comment().setBody(body.trim());
        o.comment().setUpdatedAt(Instant.now(clock));
        // Someone newly mentioned in an edit is told once; people mentioned before aren't told again.
        mentions.notifyNew(o.access().task(), o.comment().getAuthor(), o.comment().getBody(), before, Set.of(), MentionNotifier.Where.COMMENT,
                "#comment-" + o.comment().getId());
        return mapper.comment(o.comment());
    }

    @Transactional
    public void delete(Long commentId) {
        Owned o = find(commentId);
        boolean mine = o.comment().getAuthor().getId().equals(o.access().userId());
        if (!mine && !Permissions.atLeast(o.access().role(), Role.MANAGER)) throw ApiException.forbidden("You can only delete your own comments.");
        comments.delete(o.comment());
    }
}
