package dev.projectflow.repository;

import dev.projectflow.domain.TaskDependency;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TaskDependencyRepository extends JpaRepository<TaskDependency, Long> {
    @EntityGraph(attributePaths = {"blocker", "blocked", "createdBy"})
    List<TaskDependency> findByProjectId(Long projectId);

    @EntityGraph(attributePaths = {"blocker", "blocked"})
    List<TaskDependency> findByProjectIdIn(Collection<Long> projectIds);

    boolean existsByBlockerIdAndBlockedId(Long blockerId, Long blockedId);
}
