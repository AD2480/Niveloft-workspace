package dev.projectflow.service;

import static org.assertj.core.api.Assertions.assertThat;

import dev.projectflow.domain.User;
import java.util.List;
import org.junit.jupiter.api.Test;

class TextRefsTest {

    private static User user(long id, String name) {
        User u = new User();
        u.setId(id);
        u.setName(name);
        return u;
    }

    private final User priya = user(1, "Priya Nair");
    private final User rohan = user(2, "Rohan Mehta");
    private final User rohanK = user(3, "Rohan Kapoor");
    private final List<User> people = List.of(priya, rohan, rohanK);

    @Test
    void findsPeopleByFullNameOrAFirstNameOnlyOneOfThemHas() {
        assertThat(TextRefs.mentions("@Priya Nair can you check this?", people)).containsExactly(priya);
        assertThat(TextRefs.mentions("thanks @priya!", people)).containsExactly(priya);
        // Two Rohans: the first name alone is ambiguous, the full name isn't.
        assertThat(TextRefs.mentions("@Rohan please", people)).isEmpty();
        assertThat(TextRefs.mentions("@Rohan Kapoor and @Priya", people)).containsExactly(rohanK, priya);
    }

    @Test
    void ignoresEmailAddressesCodeAndNamesThatRunOn() {
        assertThat(TextRefs.mentions("mail priya@Priya Nair.dev", people)).isEmpty();
        assertThat(TextRefs.mentions("run `@Priya Nair` in code", people)).isEmpty();
        assertThat(TextRefs.mentions("```\n@Priya\n```", people)).isEmpty();
        assertThat(TextRefs.mentions("@Priyanka is someone else", people)).isEmpty();
        assertThat(TextRefs.mentions(null, people)).isEmpty();
    }

    @Test
    void namesAKeyOnlyWhenItStandsAlone() {
        assertThat(TextRefs.namesKey("Blocked by ONB-9, see notes", "ONB-9")).isTrue();
        assertThat(TextRefs.namesKey("See ONB-90 instead", "ONB-9")).isFalse();
        assertThat(TextRefs.namesKey("XONB-9 is not it", "ONB-9")).isFalse();
        assertThat(TextRefs.namesKey("ONB-9-2 is a different thing", "ONB-9")).isFalse();
        assertThat(TextRefs.namesKey("`ONB-9` in code", "ONB-9")).isFalse();
        assertThat(TextRefs.namesKey("[ONB-9 notes](https://x.example/ONB-9)", "ONB-9")).isFalse();
        assertThat(TextRefs.namesKey("see https://tracker.example/browse/ONB-9", "ONB-9")).isFalse();
        assertThat(TextRefs.namesKey("[notes](https://x.example) then ONB-9", "ONB-9")).isTrue();
        assertThat(TextRefs.namesKey(null, "ONB-9")).isFalse();
    }

    @Test
    void excerptsAroundTheKeyAsPlainText() {
        assertThat(TextRefs.excerpt("**Blocked** by [the API](https://x.example) ONB-9", "ONB-9", 160)).isEqualTo("Blocked by the API ONB-9");
        String longText = "a".repeat(200) + " ONB-9 " + "b".repeat(200);
        String cut = TextRefs.excerpt(longText, "ONB-9", 60);
        assertThat(cut).contains("ONB-9").startsWith("…").endsWith("…");
        assertThat(cut.length()).isLessThanOrEqualTo(62);
    }
}
