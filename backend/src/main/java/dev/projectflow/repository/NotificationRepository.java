package dev.projectflow.repository;

import java.util.Collection;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Page;
import dev.projectflow.domain.Notification;
import dev.projectflow.domain.NotificationType;
import java.util.List;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationRepository extends JpaRepository<Notification, Long> {
    @EntityGraph(attributePaths = "actor")
    List<Notification> findByUserIdOrderByCreatedAtDescIdDesc(Long userId);

    // Paged inbox queries: the database pages and filters, instead of loading every notification.
    @EntityGraph(attributePaths = "actor")
    Page<Notification> findByUserId(Long userId, Pageable page);

    @EntityGraph(attributePaths = "actor")
    Page<Notification> findByUserIdAndReadFalse(Long userId, Pageable page);

    @EntityGraph(attributePaths = "actor")
    Page<Notification> findByUserIdAndTypeIn(Long userId, Collection<NotificationType> types, Pageable page);

    long countByUserIdAndReadFalse(Long userId);

    List<Notification> findByUserIdAndReadFalse(Long userId);

    List<Notification> findByInvitationId(Long invitationId);

    List<Notification> findByTypeAndLink(NotificationType type, String link);

    void deleteByLink(String link);

    /** Notifications that point inside a page (a comment on a task: "/projects/1/tasks/2#comment-3"). */
    void deleteByLinkStartingWith(String prefix);
}
