package dev.projectflow.repository;

import dev.projectflow.domain.ProjectMember;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProjectMemberRepository extends JpaRepository<ProjectMember, Long> {
    @EntityGraph(attributePaths = {"user", "project"})
    Optional<ProjectMember> findByProjectIdAndUserId(Long projectId, Long userId);

    @EntityGraph(attributePaths = "user")
    List<ProjectMember> findByProjectId(Long projectId);

    @EntityGraph(attributePaths = {"project", "user"})
    List<ProjectMember> findByUserId(Long userId);

    @EntityGraph(attributePaths = "user")
    List<ProjectMember> findByProjectIdIn(Collection<Long> projectIds);

    long countByProjectId(Long projectId);

    boolean existsByProjectIdAndUserId(Long projectId, Long userId);
}
