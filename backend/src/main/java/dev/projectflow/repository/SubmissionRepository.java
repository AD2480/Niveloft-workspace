package dev.projectflow.repository;

import dev.projectflow.domain.Submission;
import dev.projectflow.domain.SubmissionStatus;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SubmissionRepository extends JpaRepository<Submission, Long> {
    @EntityGraph(attributePaths = "submittedBy")
    List<Submission> findByTaskIdOrderByNumberDesc(Long taskId);

    Optional<Submission> findFirstByTaskIdAndStatus(Long taskId, SubmissionStatus status);

    long countByTaskId(Long taskId);

    @Query("select s.task.id, count(s) from Submission s where s.task.id in :ids group by s.task.id")
    List<Object[]> countByTaskIds(@Param("ids") Collection<Long> ids);

    @Query("select s from Submission s join fetch s.task t where t.project.id in :projectIds and s.status = :status")
    List<Submission> findByProjectIdsAndStatus(@Param("projectIds") Collection<Long> projectIds, @Param("status") SubmissionStatus status);

    @Query("select s from Submission s join fetch s.task t join fetch s.submittedBy where t.project.id in :projectIds")
    List<Submission> findByProjectIds(@Param("projectIds") Collection<Long> projectIds);

    @Query("select s from Submission s join fetch s.task t where t.project.id = :projectId")
    List<Submission> findByProjectId(@Param("projectId") Long projectId);
}
