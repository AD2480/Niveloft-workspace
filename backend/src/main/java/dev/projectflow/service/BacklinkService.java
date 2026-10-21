package dev.projectflow.service;

import dev.projectflow.domain.Comment;
import dev.projectflow.domain.Task;
import dev.projectflow.repository.CommentRepository;
import dev.projectflow.repository.ProjectMemberRepository;
import dev.projectflow.repository.TaskRepository;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.security.ProjectAccess.TaskAccess;
import dev.projectflow.web.dto.Dto;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Backlinks: where else a task is mentioned by its key, in other tasks' descriptions and in
 * comments on other tasks, across the projects the reader belongs to (and only those). A cheap
 * text search first, then an exact check of the key, so ONB-9 never matches ONB-90.
 */
@Service
public class BacklinkService {

    static final int MAX = 30;

    private final ProjectAccess access;
    private final ProjectMemberRepository members;
    private final TaskRepository tasks;
    private final CommentRepository comments;
    private final DtoMapper mapper;

    public BacklinkService(ProjectAccess access, ProjectMemberRepository members, TaskRepository tasks, CommentRepository comments, DtoMapper mapper) {
        this.access = access;
        this.members = members;
        this.tasks = tasks;
        this.comments = comments;
        this.mapper = mapper;
    }

    @Transactional(readOnly = true)
    public List<Dto.TaskMention> mentionsOf(Long taskId) {
        TaskAccess a = access.requireTask(taskId);
        String key = DtoMapper.taskKey(a.task());
        List<Long> projectIds = members.findByUserId(a.userId()).stream().map(m -> m.getProject().getId()).toList();
        if (projectIds.isEmpty()) return List.of();
        String like = "%" + key + "%";
        List<Dto.TaskMention> out = new ArrayList<>();
        for (Task t : tasks.findDescriptionMentioning(projectIds, like)) {
            if (t.getId().equals(taskId) || !TextRefs.namesKey(t.getDescription(), key)) continue;
            out.add(new Dto.TaskMention("DESCRIPTION", t.getId(), DtoMapper.taskKey(t), t.getTitle(), t.getStatus(), t.getProject().getId(), t.getProject().getName(),
                    null, mapper.summary(t.getReporter()), TextRefs.excerpt(t.getDescription(), key, 160), t.getUpdatedAt()));
        }
        for (Comment c : comments.findMentioning(projectIds, like, PageRequest.of(0, 200))) {
            Task t = c.getTask();
            if (t.getId().equals(taskId) || !TextRefs.namesKey(c.getBody(), key)) continue;
            out.add(new Dto.TaskMention("COMMENT", t.getId(), DtoMapper.taskKey(t), t.getTitle(), t.getStatus(), t.getProject().getId(), t.getProject().getName(),
                    c.getId(), mapper.summary(c.getAuthor()), TextRefs.excerpt(c.getBody(), key, 160), c.getCreatedAt()));
        }
        out.sort(Comparator.comparing(Dto.TaskMention::at, Comparator.nullsLast(Comparator.reverseOrder())));
        return out.size() > MAX ? List.copyOf(out.subList(0, MAX)) : out;
    }
}
