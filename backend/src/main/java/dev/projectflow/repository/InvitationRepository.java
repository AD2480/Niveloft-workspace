package dev.projectflow.repository;

import dev.projectflow.domain.Invitation;
import dev.projectflow.domain.InvitationStatus;
import java.util.List;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InvitationRepository extends JpaRepository<Invitation, Long> {
    @EntityGraph(attributePaths = {"project", "invitedBy"})
    List<Invitation> findByProjectIdAndStatusOrderByCreatedAtDesc(Long projectId, InvitationStatus status);

    @EntityGraph(attributePaths = {"project", "invitedBy"})
    List<Invitation> findByEmailIgnoreCaseAndStatusOrderByCreatedAtDesc(String email, InvitationStatus status);

    boolean existsByProjectIdAndEmailIgnoreCaseAndStatus(Long projectId, String email, InvitationStatus status);

    long countByProjectIdAndStatus(Long projectId, InvitationStatus status);
}
