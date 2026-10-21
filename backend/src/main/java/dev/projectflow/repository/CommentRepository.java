package dev.projectflow.repository;

import dev.projectflow.domain.Comment;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CommentRepository extends JpaRepository<Comment, Long> {
    @EntityGraph(attributePaths = "author")
    List<Comment> findByTaskIdOrderByCreatedAtAscIdAsc(Long taskId);

    @Query("select c.task.id, count(c) from Comment c where c.task.id in :ids group by c.task.id")
    List<Object[]> countByTaskIds(@Param("ids") Collection<Long> ids);

    /** Comments in these projects that contain the text (a task key; checked exactly afterwards), newest first. */
    @EntityGraph(attributePaths = {"author", "task", "task.project"})
    @Query("select c from Comment c where c.task.project.id in :projectIds and c.body like :pattern order by c.createdAt desc, c.id desc")
    List<Comment> findMentioning(@Param("projectIds") Collection<Long> projectIds, @Param("pattern") String pattern, Pageable page);
}
