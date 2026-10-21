package dev.projectflow.repository;

import dev.projectflow.domain.Project;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProjectRepository extends JpaRepository<Project, Long> {
    boolean existsByKey(String key);

    long countByOwnerId(Long ownerId);

    boolean existsByKeyAndIdNot(String key, Long id);

    /** Delete through the database's cascades, then discard entities for the removed rows. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from Project p where p.id = :id")
    void deleteProjectRow(@Param("id") Long id);

    /**
     * Row lock on the project (SELECT … FOR UPDATE). Serialises graph edits so two concurrent
     * "A depends on B" / "B depends on A" requests can't both pass the cycle check.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Project p where p.id = :id")
    Optional<Project> lockById(@Param("id") Long id);
}
