package dev.projectflow.service;

import dev.projectflow.domain.*;
import dev.projectflow.repository.MilestoneRepository;
import dev.projectflow.repository.TaskRepository;
import dev.projectflow.repository.UserRepository;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.security.ProjectAccess.Access;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Milestones: dated checkpoints whose progress comes from their linked tasks. */
@Service
public class MilestoneService {

    private final MilestoneRepository milestones;
    private final TaskRepository tasks;
    private final UserRepository users;
    private final ProjectAccess access;
    private final ActivityService activity;
    private final DtoMapper mapper;
    private final Clock clock;

    public MilestoneService(MilestoneRepository milestones, TaskRepository tasks, UserRepository users, ProjectAccess access,
                            ActivityService activity, DtoMapper mapper, Clock clock) {
        this.milestones = milestones;
        this.tasks = tasks;
        this.users = users;
        this.access = access;
        this.activity = activity;
        this.mapper = mapper;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<Dto.Milestone> list(Long projectId) {
        access.require(projectId);
        List<Task> projectTasks = tasks.findByProjectId(projectId);
        return milestones.findByProjectIdOrderByDueDateAsc(projectId).stream().map(m -> mapper.milestone(m, projectTasks)).toList();
    }

    private Access manager(Long projectId) {
        Access a = access.require(projectId);
        if (!Permissions.manageMilestones(a.role())) throw ApiException.forbidden("Only owners and managers can manage milestones.");
        return a;
    }

    @Transactional
    public Dto.Milestone create(Long projectId, Requests.MilestoneRequest req) {
        Access a = manager(projectId);
        Milestone m = new Milestone();
        m.setProject(a.project());
        apply(m, req);
        m.setCreatedAt(Instant.now(clock));
        milestones.save(m);
        activity.log(a.project(), null, users.getReferenceById(a.userId()), ActivityType.MILESTONE_CREATED, "added milestone “" + m.getName() + "”");
        return mapper.milestone(m, tasks.findByProjectId(projectId));
    }

    private void apply(Milestone m, Requests.MilestoneRequest req) {
        m.setName(req.name().trim());
        m.setDescription(req.description() == null || req.description().isBlank() ? null : req.description().trim());
        m.setDueDate(req.dueDate());
        if (req.completed() && !m.isCompleted()) m.setCompletedAt(Instant.now(clock));
        if (!req.completed()) m.setCompletedAt(null);
        m.setCompleted(req.completed());
    }

    private Milestone find(Long id) {
        return milestones.findById(id).orElseThrow(() -> ApiException.notFound("Milestone not found."));
    }

    @Transactional
    public Dto.Milestone update(Long id, Requests.MilestoneRequest req) {
        Milestone m = find(id);
        Access a = manager(m.getProject().getId());
        boolean becameComplete = req.completed() && !m.isCompleted();
        apply(m, req);
        activity.log(a.project(), null, users.getReferenceById(a.userId()), ActivityType.MILESTONE_UPDATED,
                becameComplete ? "marked milestone “" + m.getName() + "” complete" : "updated milestone “" + m.getName() + "”");
        return mapper.milestone(m, tasks.findByProjectId(a.project().getId()));
    }

    @Transactional
    public void delete(Long id) {
        Milestone m = find(id);
        Access a = manager(m.getProject().getId());
        for (Task t : tasks.findByMilestoneId(id)) t.setMilestone(null);
        milestones.delete(m);
        activity.log(a.project(), null, users.getReferenceById(a.userId()), ActivityType.MILESTONE_DELETED, "deleted milestone “" + m.getName() + "”");
    }
}
