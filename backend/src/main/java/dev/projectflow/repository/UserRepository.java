package dev.projectflow.repository;

import dev.projectflow.domain.User;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmailIgnoreCase(String email);

    boolean existsByEmailIgnoreCase(String email);

    /** The account's current session version, or empty if the account no longer exists. */
    @Query("select u.sessionVersion from User u where u.id = :id")
    Optional<Integer> findSessionVersion(@Param("id") Long id);
}
