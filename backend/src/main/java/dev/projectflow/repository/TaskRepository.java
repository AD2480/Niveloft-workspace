package dev.projectflow.repository;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.Lock;
import dev.projectflow.domain.Task;
import dev.projectflow.domain.TaskStatus;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TaskRepository extends JpaRepository<Task, Long> {
    long countByProjectId(Long projectId);

    /** The tasks assigned to one person across the given projects (My work). */
    @EntityGraph(attributePaths = {"assignee", "reporter", "milestone", "project"})
    List<Task> findByAssigneeIdAndProjectIdIn(Long assigneeId, Collection<Long> projectIds);

    /**
     * Row lock on the task (SELECT … FOR UPDATE). Serialises submitting work, so a double click or
     * two tabs can't create two submissions for the same task.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from Task t where t.id = :id")
    Optional<Task> lockById(@Param("id") Long id);

    @EntityGraph(attributePaths = {"assignee", "reporter", "milestone", "project"})
    List<Task> findByProjectId(Long projectId);

    /** One task by its number within a project (the number in its key: ONB-9 is 9). */
    Optional<Task> findByProjectIdAndNumber(Long projectId, int number);

    @EntityGraph(attributePaths = {"assignee", "reporter", "milestone", "project"})
    List<Task> findByProjectIdIn(Collection<Long> projectIds);

    List<Task> findByProjectIdAndStatus(Long projectId, TaskStatus status);

    List<Task> findByMilestoneId(Long milestoneId);

    @Query("select t from Task t where t.project.id = :projectId and t.assignee.id = :userId and t.status <> dev.projectflow.domain.TaskStatus.DONE")
    List<Task> findOpenAssigned(@Param("projectId") Long projectId, @Param("userId") Long userId);

    /** Tasks in these projects whose description contains the text (a task key; checked exactly afterwards). */
    @EntityGraph(attributePaths = {"project", "reporter"})
    @Query("select t from Task t where t.project.id in :projectIds and t.description like :pattern")
    List<Task> findDescriptionMentioning(@Param("projectIds") Collection<Long> projectIds, @Param("pattern") String pattern);
}
