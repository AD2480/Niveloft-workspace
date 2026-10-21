package dev.projectflow.service;

import dev.projectflow.domain.NotificationType;
import dev.projectflow.domain.ProjectMember;
import dev.projectflow.domain.Task;
import dev.projectflow.domain.User;
import dev.projectflow.repository.ProjectMemberRepository;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Tells people when they're @mentioned in a comment or a task description. Only members of the
 * task's project can be mentioned (nobody outside it is told anything about it), the writer is
 * never told about their own words, and an edit only tells the people it newly mentions.
 */
@Service
public class MentionNotifier {

    /** Where the words were written, for the notification's sentence. */
    public enum Where {
        COMMENT("on"),
        DESCRIPTION("in the description of");

        final String phrase;

        Where(String phrase) {
            this.phrase = phrase;
        }
    }

    private final ProjectMemberRepository members;
    private final NotificationService notifications;

    public MentionNotifier(ProjectMemberRepository members, NotificationService notifications) {
        this.members = members;
        this.notifications = notifications;
    }

    /**
     * Notifies the members mentioned in {@code text} who weren't already mentioned in {@code before}
     * and aren't in {@code skip} (told about this another way), and returns everyone mentioned.
     * {@code anchor} (like "#comment-12") takes them to the exact place on the task's page.
     */
    public Set<Long> notifyNew(Task task, User writer, String text, String before, Set<Long> skip, Where where, String anchor) {
        if (text == null || text.indexOf('@') < 0) return Set.of();
        List<User> people = members.findByProjectId(task.getProject().getId()).stream().map(ProjectMember::getUser).toList();
        Set<Long> already = new HashSet<>(skip);
        for (User u : TextRefs.mentions(before, people)) already.add(u.getId());
        String key = DtoMapper.taskKey(task);
        Set<Long> mentioned = new LinkedHashSet<>();
        for (User u : TextRefs.mentions(text, people)) {
            mentioned.add(u.getId());
            if (already.contains(u.getId())) continue;
            String around = TextRefs.excerpt(text, "@" + u.getName().trim().split("\\s+")[0], 120);
            notifications.notify(u.getId(), writer, NotificationType.MENTION, "Mentioned you",
                    writer.getName() + " mentioned you " + where.phrase + " " + key + ": “" + around + "”", TaskService.link(task) + (anchor == null ? "" : anchor),
                    task.getProject().getId(), null);
        }
        return mentioned;
    }
}
