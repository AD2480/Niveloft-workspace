package dev.projectflow.repository;

import dev.projectflow.domain.AccountToken;
import java.time.Instant;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AccountTokenRepository extends JpaRepository<AccountToken, Long> {

    Optional<AccountToken> findByTokenHash(String tokenHash);

    /** Uses a link once: 1 if this call used it, 0 if it was already used (e.g. two clicks at once). */
    @Modifying
    @Query("update AccountToken t set t.usedAt = :now where t.id = :id and t.usedAt is null")
    int markUsed(@Param("id") Long id, @Param("now") Instant now);

    /** Retires every unused link of any kind (after a password reset or change). */
    @Modifying
    @Query("update AccountToken t set t.usedAt = :now where t.userId = :userId and t.usedAt is null")
    int retireEverything(@Param("userId") Long userId, @Param("now") Instant now);

    /** Marks every unused link of this kind as used, so only the newest one works. */
    @Modifying
    @Query("update AccountToken t set t.usedAt = :now where t.userId = :userId and t.purpose = :purpose and t.usedAt is null")
    int retireAll(@Param("userId") Long userId, @Param("purpose") AccountToken.Purpose purpose, @Param("now") Instant now);

    /** How many links of this kind were created for the account since a moment (a per-account send limit). */
    long countByUserIdAndPurposeAndCreatedAtAfter(Long userId, AccountToken.Purpose purpose, Instant since);

    @Modifying
    @Query("delete from AccountToken t where t.expiresAt < :cutoff")
    int deleteExpiredBefore(@Param("cutoff") Instant cutoff);
}
