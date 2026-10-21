package dev.projectflow.web;

import java.util.List;
import java.util.function.Function;

/** Zero-based page of results, matching the frontend's {@code Page<T>} type. */
public record PageResponse<T>(List<T> content, int page, int size, long totalElements, int totalPages) {

    /** Page an in-memory list (used where results are filtered/sorted after loading). */
    public static <S, T> PageResponse<T> of(List<S> all, int page, int size, Function<S, T> mapper) {
        int safeSize = Math.min(Math.max(size, 1), 500);
        int totalPages = Math.max(1, (int) Math.ceil(all.size() / (double) safeSize));
        int safePage = Math.min(Math.max(page, 0), totalPages - 1);
        int from = safePage * safeSize;
        int to = Math.min(all.size(), from + safeSize);
        List<T> content = all.subList(from, to).stream().map(mapper).toList();
        return new PageResponse<>(content, safePage, safeSize, all.size(), totalPages);
    }
}
