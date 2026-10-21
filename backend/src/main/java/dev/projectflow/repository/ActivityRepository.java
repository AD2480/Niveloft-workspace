package dev.projectflow.repository;

import dev.projectflow.domain.Activity;
import dev.projectflow.domain.ActivityType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ActivityRepository extends JpaRepository<Activity, Long> {
    @EntityGraph(attributePaths = {"actor", "project"})
    Page<Activity> findByProjectIdOrderByCreatedAtDescIdDesc(Long projectId, Pageable pageable);

    @EntityGraph(attributePaths = {"actor", "project"})
    List<Activity> findByTaskIdOrderByCreatedAtDescIdDesc(Long taskId);

    @EntityGraph(attributePaths = {"actor", "project"})
    List<Activity> findTop12ByProjectIdInOrderByCreatedAtDescIdDesc(Collection<Long> projectIds);

    @Modifying
    @Query("update Activity a set a.taskId = null where a.taskId = :taskId")
    void detachTask(@Param("taskId") Long taskId);

    /** What other people did in these projects after a moment, counted by kind. */
    @Query("select a.type, count(a) from Activity a where a.project.id in :projectIds and a.createdAt > :since and a.actor.id <> :me group by a.type")
    List<Object[]> countOthersSince(@Param("projectIds") Collection<Long> projectIds, @Param("since") Instant since, @Param("me") Long me);

    /** How many times other people changed one field (a due date, say) after a moment. */
    @Query("select count(a) from Activity a where a.project.id in :projectIds and a.createdAt > :since and a.actor.id <> :me and a.type = :type and a.fieldName = :field")
    long countOthersFieldChangesSince(@Param("projectIds") Collection<Long> projectIds, @Param("since") Instant since, @Param("me") Long me,
                                      @Param("type") ActivityType type, @Param("field") String field);

    /** Changes of the given kinds in one project after a moment, oldest first (for replaying a forecast as of then). */
    @Query("select a from Activity a where a.project.id = :projectId and a.createdAt > :since and a.type in :types order by a.createdAt asc, a.id asc")
    List<Activity> findChangesSince(@Param("projectId") Long projectId, @Param("since") Instant since, @Param("types") Collection<ActivityType> types, Pageable page);

    /** What other people did after a moment, newest first. */
    @EntityGraph(attributePaths = {"actor", "project"})
    @Query("select a from Activity a where a.project.id in :projectIds and a.createdAt > :since and a.actor.id <> :me order by a.createdAt desc, a.id desc")
    List<Activity> findOthersSince(@Param("projectIds") Collection<Long> projectIds, @Param("since") Instant since, @Param("me") Long me, Pageable page);
}
