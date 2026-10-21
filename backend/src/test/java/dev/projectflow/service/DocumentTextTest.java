package dev.projectflow.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** How documents become passages, and how their words are read for search. */
class DocumentTextTest {

    @Test
    void splitsAtHeadingsAndParagraphsAndRemembersWhereEachPassageIs() {
        List<DocumentText.Passage> p = DocumentText.split("Intro line.\n\n# Sign-in\n\nPasskeys first.\n\n## Sessions\n\n30 minutes idle.\nKept sign-ins: 30 days.\n\n### Edge cases\n\nNone.\n\n# Billing\n\nMonthly.");
        assertThat(p).extracting(DocumentText.Passage::heading).containsExactly(null, "Sign-in", "Sign-in › Sessions", "Sign-in › Sessions › Edge cases", "Billing");
        assertThat(p.get(2).content()).isEqualTo("30 minutes idle.\nKept sign-ins: 30 days.");
        assertThat(p).extracting(DocumentText.Passage::ordinal).containsExactly(0, 1, 2, 3, 4);
    }

    @Test
    void gathersShortParagraphsAndCutsLongOnesAtSentences() {
        String para = "This sentence is about forty characters. ".repeat(10).strip(); // ~410 characters
        List<DocumentText.Passage> gathered = DocumentText.split(para + "\n\n" + para + "\n\n" + para);
        assertThat(gathered).hasSize(2); // two fit in ~900 characters, the third starts a new passage
        String huge = "Word after word without an end and still going on and on. ".repeat(60);
        List<DocumentText.Passage> cut = DocumentText.split(huge);
        assertThat(cut.size()).isGreaterThan(3);
        assertThat(cut).allMatch(x -> x.content().length() <= DocumentText.LONGEST_PARAGRAPH);
        assertThat(DocumentText.split("   \n\n  ")).isEmpty();
    }

    @Test
    void readsWordsAcrossLanguagesWithoutTheCommonOnes() {
        assertThat(DocumentText.words("What is the Session-Timeout? Größe: 30 Min.")).containsExactly("session", "timeout", "größe", "30", "min");
        assertThat(DocumentText.queryWords("timeout timeout the session", 8)).containsExactly("timeout", "session");
    }

    @Test
    void ranksRarerWordsAndHeadingsHigher() {
        List<DocumentSearch.Candidate> c = List.of(
                new DocumentSearch.Candidate(1, 9, "Spec", "Billing", "Invoices go out monthly. The session for billing is separate."),
                new DocumentSearch.Candidate(2, 9, "Spec", "Sessions", "A session ends after 30 minutes idle."),
                new DocumentSearch.Candidate(3, 9, "Spec", "Other", "Nothing relevant here."));
        List<DocumentSearch.Hit> hits = DocumentSearch.rank(c, List.of("session", "idle"), 20, 5);
        assertThat(hits).extracting(DocumentSearch.Hit::passageId).containsExactly(2L, 1L);
    }
}
