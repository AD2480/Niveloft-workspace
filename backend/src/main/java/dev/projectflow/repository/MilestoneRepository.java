package dev.projectflow.repository;

import dev.projectflow.domain.Milestone;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MilestoneRepository extends JpaRepository<Milestone, Long> {
    List<Milestone> findByProjectIdOrderByDueDateAsc(Long projectId);

    List<Milestone> findByProjectIdInOrderByDueDateAsc(Collection<Long> projectIds);
}
