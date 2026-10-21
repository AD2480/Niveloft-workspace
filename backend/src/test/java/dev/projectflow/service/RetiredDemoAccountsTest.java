package dev.projectflow.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** What the operator is told about accounts left from the retired demo data. */
class RetiredDemoAccountsTest {

    @Test
    void saysNothingWhenThereAreNone() {
        assertThat(RetiredDemoAccounts.message(List.of(), true)).isNull();
        assertThat(RetiredDemoAccounts.message(null, false)).isNull();
    }

    @Test
    void namesTheAccountsAndWhatHappened() {
        String production = RetiredDemoAccounts.message(List.of("aarav@projectflow.dev", "priya@projectflow.dev"), true);
        assertThat(production).startsWith("Suspended 2 account(s)").contains("aarav@projectflow.dev, priya@projectflow.dev").contains("password was published")
                .contains("can no longer sign in");
        String development = RetiredDemoAccounts.message(List.of("aarav@projectflow.dev"), false);
        assertThat(development).startsWith("This database holds 1 account(s)").contains("A production server suspends them");
    }

    @Test
    void listsAtMostEight() {
        List<String> many = java.util.stream.IntStream.range(0, 10).mapToObj(i -> "u" + i + "@projectflow.dev").toList();
        assertThat(RetiredDemoAccounts.message(many, true)).contains("u7@projectflow.dev, …").doesNotContain("u8@");
    }
}
