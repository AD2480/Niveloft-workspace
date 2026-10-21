package dev.projectflow.service;

import dev.projectflow.domain.Activity;
import dev.projectflow.domain.ActivityType;
import dev.projectflow.domain.User;
import dev.projectflow.repository.ActivityRepository;
import dev.projectflow.repository.ProjectMemberRepository;
import dev.projectflow.repository.UserRepository;
import dev.projectflow.web.dto.Dto;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * "Since you were last here" on Today: what other people did in your projects after you last
 * caught up, counted from the activity records (nothing summarised or guessed), with the latest
 * few. Kept on the server, so it's the same on every device you use.
 */
@Service
public class CatchUpService {

    /** Counting stops this far back, however long you've been away. */
    static final Duration HORIZON = Duration.ofDays(14);
    static final int LATEST = 6;

    private final UserRepository users;
    private final ProjectMemberRepository members;
    private final ActivityRepository activities;
    private final ActivityService activity;
    private final Clock clock;

    public CatchUpService(UserRepository users, ProjectMemberRepository members, ActivityRepository activities, ActivityService activity, Clock clock) {
        this.users = users;
        this.members = members;
        this.activities = activities;
        this.activity = activity;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Dto.CatchUp forUser(Long userId) {
        User me = users.findById(userId).orElseThrow();
        Instant since = me.getCaughtUpAt();
        if (since == null) return new Dto.CatchUp(null, false, Map.of(), 0, List.of());
        Instant floor = Instant.now(clock).minus(HORIZON);
        boolean capped = since.isBefore(floor);
        Instant from = capped ? floor : since;
        List<Long> projectIds = members.findByUserId(userId).stream().map(m -> m.getProject().getId()).toList();
        if (projectIds.isEmpty()) return new Dto.CatchUp(from, capped, Map.of(), 0, List.of());
        Map<ActivityType, Long> counts = new EnumMap<>(ActivityType.class);
        for (Object[] row : activities.countOthersSince(projectIds, from, userId)) counts.put((ActivityType) row[0], ((Number) row[1]).longValue());
        long dueDates = activities.countOthersFieldChangesSince(projectIds, from, userId, ActivityType.TASK_UPDATED, "dueDate");
        List<Activity> latest = activities.findOthersSince(projectIds, from, userId, PageRequest.of(0, LATEST));
        return new Dto.CatchUp(from, capped, counts, dueDates, activity.toDtos(latest));
    }

    /** You've seen it: the next catch-up starts from now. */
    @Transactional
    public void markCaughtUp(Long userId) {
        users.findById(userId).ifPresent(u -> u.setCaughtUpAt(Instant.now(clock)));
    }
}
