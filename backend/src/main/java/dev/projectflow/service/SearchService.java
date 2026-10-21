package dev.projectflow.service;

import dev.projectflow.domain.*;
import dev.projectflow.repository.ProjectMemberRepository;
import dev.projectflow.repository.TaskRepository;
import dev.projectflow.web.dto.Dto;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Quick search for the command palette (⌘K). Only projects the caller is a member of are
 * searched, so results never reveal records they could not open.
 */
@Service
public class SearchService {

    private final ProjectMemberRepository members;
    private final TaskRepository tasks;

    public SearchService(ProjectMemberRepository members, TaskRepository tasks) {
        this.members = members;
        this.tasks = tasks;
    }

    /** Lower is better: exact key, key prefix, title prefix, word prefix, substring. */
    static int rank(String query, String key, String title) {
        String q = query.toLowerCase(Locale.ROOT);
        String k = key == null ? "" : key.toLowerCase(Locale.ROOT);
        String t = title.toLowerCase(Locale.ROOT);
        if (k.equals(q)) return 0;
        if (!k.isEmpty() && k.startsWith(q)) return 1;
        if (t.startsWith(q)) return 2;
        if (t.contains(" " + q)) return 3;
        if (t.contains(q) || k.contains(q)) return 4;
        return -1;
    }

    @Transactional(readOnly = true)
    public Dto.SearchResult search(Long userId, String rawQuery, int limit) {
        String q = rawQuery == null ? "" : rawQuery.trim();
        int max = Math.max(1, Math.min(limit, 20));
        if (q.isEmpty()) return new Dto.SearchResult(q, List.of(), List.of());

        List<Project> projects = members.findByUserId(userId).stream().map(ProjectMember::getProject).toList();
        List<Dto.SearchHit> projectHits = projects.stream()
                .map(p -> Map.entry(p, rank(q, p.getKey(), p.getName())))
                .filter(e -> e.getValue() >= 0)
                .sorted(Comparator.comparing((Map.Entry<Project, Integer> e) -> e.getValue()).thenComparing(e -> e.getKey().getName()))
                .limit(5)
                .map(e -> {
                    Project p = e.getKey();
                    return new Dto.SearchHit("PROJECT", p.getId(), p.getKey(), p.getName(), p.getStatus().name().replace('_', ' ').toLowerCase(Locale.ROOT),
                            p.getColor(), null, "/projects/" + p.getId());
                })
                .toList();

        List<Long> ids = projects.stream().map(Project::getId).toList();
        List<Dto.SearchHit> taskHits = (ids.isEmpty() ? List.<Task>of() : tasks.findByProjectIdIn(ids)).stream()
                .map(t -> Map.entry(t, rank(q, DtoMapper.taskKey(t), t.getTitle())))
                .filter(e -> e.getValue() >= 0)
                .sorted(Comparator.comparing((Map.Entry<Task, Integer> e) -> e.getValue())
                        .thenComparing(e -> e.getKey().getStatus() == TaskStatus.DONE)
                        .thenComparing(e -> e.getKey().getUpdatedAt(), Comparator.reverseOrder()))
                .limit(max)
                .map(e -> {
                    Task t = e.getKey();
                    Project p = t.getProject();
                    String who = t.getAssignee() == null ? "Unassigned" : t.getAssignee().getName();
                    return new Dto.SearchHit("TASK", t.getId(), DtoMapper.taskKey(t), t.getTitle(), p.getName() + ", " + who, p.getColor(), t.getStatus(), TaskService.link(t));
                })
                .toList();
        return new Dto.SearchResult(q, projectHits, taskHits);
    }
}
