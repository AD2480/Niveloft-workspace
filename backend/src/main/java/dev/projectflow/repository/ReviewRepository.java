package dev.projectflow.repository;

import dev.projectflow.domain.Review;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewRepository extends JpaRepository<Review, Long> {
    @EntityGraph(attributePaths = "reviewer")
    Optional<Review> findBySubmissionId(Long submissionId);

    @EntityGraph(attributePaths = {"reviewer", "submission"})
    List<Review> findBySubmissionIdIn(Collection<Long> submissionIds);
}
