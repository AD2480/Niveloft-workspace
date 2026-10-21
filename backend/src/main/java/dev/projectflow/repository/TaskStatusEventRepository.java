package dev.projectflow.repository;

import dev.projectflow.domain.TaskStatusEvent;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TaskStatusEventRepository extends JpaRepository<TaskStatusEvent, Long> {
    List<TaskStatusEvent> findByProjectIdOrderByOccurredAtAscIdAsc(Long projectId);
}
