package dev.projectflow.repository;

import dev.projectflow.domain.ChecklistItem;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChecklistItemRepository extends JpaRepository<ChecklistItem, Long> {
}
