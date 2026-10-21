package dev.projectflow.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DependencyServiceTest {

    @Test
    void findsTheChainThatWouldCloseALoop() {
        Map<Long, List<Long>> edges = Map.of(1L, List.of(2L), 2L, List.of(3L, 4L));
        assertThat(DependencyService.path(edges, 1L, 4L)).containsExactly(1L, 2L, 4L);
        assertThat(DependencyService.path(edges, 3L, 1L)).isEmpty();
        assertThat(DependencyService.path(edges, 2L, 2L)).containsExactly(2L);
    }
}
