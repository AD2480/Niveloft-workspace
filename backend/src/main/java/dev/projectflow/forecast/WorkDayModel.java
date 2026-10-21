package dev.projectflow.forecast;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/**
 * A forecast model trained by the {@code ml/} kit and written as {@code model.json} (schema
 * {@value #SCHEMA}): it predicts log working days from {@link WorkDayFeatures}. Four kinds, all the
 * kit's built-in candidates: a linear formula (ridge), gradient-boosted trees (gbm), Niveloft's
 * forecast plus such trees (correction), and a random forest. Prediction follows scikit-learn's
 * own: the kit's tests and this server's check the two agree on the same tasks.
 *
 * <p>The file is checked when it's read: the right schema and source, the same features in the
 * same order as this server builds, every tree well formed. Anything else is refused with the
 * reason, and the trial stays off.
 */
public final class WorkDayModel {

    public static final String SCHEMA = "niveloft-work-days/1";
    public static final String SOURCE = "niveloft-task-history-v1";
    /** A model file larger than this isn't read (a big random forest is a few megabytes). */
    public static final int MAX_BYTES = 64 * 1024 * 1024;

    /** The file isn't a model this server can run. */
    public static final class Invalid extends Exception {
        public Invalid(String message) {
            super(message);
        }
    }

    private interface Predictor {
        double predict(double[] x);
    }

    private record Tree(int[] feature, double[] threshold, boolean[] missingLeft, int[] left, int[] right, boolean[] leaf, double[] value) {}

    private final String id;
    private final String name;
    private final String description;
    private final String kind;
    private final Instant trainedThrough;
    private final int trainedTasks;
    private final List<String> trainedProjects;
    private final boolean synthetic;
    private final Predictor predictor;

    private WorkDayModel(String id, String name, String description, String kind, Instant trainedThrough, int trainedTasks, List<String> trainedProjects,
                         boolean synthetic, Predictor predictor) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.kind = kind;
        this.trainedThrough = trainedThrough;
        this.trainedTasks = trainedTasks;
        this.trainedProjects = trainedProjects;
        this.synthetic = synthetic;
        this.predictor = predictor;
    }

    /** The first 16 hex digits of the file's SHA-256: names the model in the trial's records. */
    public String id() {
        return id;
    }

    public String name() {
        return name;
    }

    public String description() {
        return description;
    }

    public String kind() {
        return kind;
    }

    /** The last approval it learned from; work that could start after this is new to it. Null when the file doesn't say. */
    public Instant trainedThrough() {
        return trainedThrough;
    }

    public int trainedTasks() {
        return trainedTasks;
    }

    public List<String> trainedProjects() {
        return trainedProjects;
    }

    /** Trained on the kit's made-up data: for trying the trial, never for decisions. */
    public boolean synthetic() {
        return synthetic;
    }

    /** Log working days for one task's features (in {@link WorkDayFeatures#FEATURES} order; NaN is missing). */
    public double predictLog(double[] features) {
        if (features.length != WorkDayFeatures.FEATURES.size()) throw new IllegalArgumentException("expected " + WorkDayFeatures.FEATURES.size() + " features");
        return predictor.predict(features);
    }

    /** Working days. */
    public double predictDays(double[] features) {
        return Math.exp(predictLog(features));
    }

    // ------------------------------------------------------------------ reading

    public static WorkDayModel read(byte[] bytes, ObjectMapper json) throws Invalid {
        if (bytes.length > MAX_BYTES) throw new Invalid("the file is larger than " + (MAX_BYTES >> 20) + " MB");
        JsonNode doc;
        try {
            doc = json.readTree(new String(bytes, StandardCharsets.UTF_8));
        } catch (Exception e) {
            throw new Invalid("it isn’t JSON");
        }
        if (doc == null || !doc.isObject()) throw new Invalid("it isn’t a JSON object");
        if (!SCHEMA.equals(doc.path("schema").asText())) throw new Invalid("its schema isn’t " + SCHEMA + " (it’s " + doc.path("schema").asText("missing") + ")");
        if (!SOURCE.equals(doc.path("source").asText())) {
            throw new Invalid("it wasn’t trained on Niveloft task history (" + doc.path("source").asText("no source given") + "), so its predictions don’t mean the same thing");
        }
        List<String> features = new ArrayList<>();
        doc.path("features").forEach(f -> features.add(f.asText()));
        if (!features.equals(WorkDayFeatures.FEATURES)) throw new Invalid("its features aren’t the ones this server builds, in the same order");
        JsonNode part = doc.path("model");
        String kind = part.path("kind").asText();
        int n = features.size();
        Predictor p = switch (kind) {
            case "linear" -> linear(part, n);
            case "gbm" -> boosted(part, n, -1);
            case "correction" -> boosted(part, n, indexOf(features, part.path("base_feature").asText()));
            case "forest" -> forest(part, n);
            default -> throw new Invalid("it’s a kind of model this server can’t run (" + (kind.isEmpty() ? "none given" : kind) + ")");
        };
        JsonNode trained = doc.path("trained");
        Instant through = null;
        String t = trained.path("through").asText("");
        if (!t.isBlank()) {
            try {
                through = OffsetDateTime.parse(t).toInstant();
            } catch (DateTimeParseException e) {
                throw new Invalid("its training date isn’t a date (" + t + ")");
            }
        }
        List<String> projects = new ArrayList<>();
        trained.path("projects").forEach(x -> projects.add(x.asText()));
        return new WorkDayModel(sha(bytes), doc.path("name").asText(kind), doc.path("description").asText(""), kind, through,
                trained.path("tasks").asInt(0), List.copyOf(projects), trained.path("synthetic").asBoolean(false), p);
    }

    private static int indexOf(List<String> features, String name) throws Invalid {
        int i = features.indexOf(name);
        if (i < 0) throw new Invalid("its base feature " + name + " isn’t one of the features");
        return i;
    }

    private static String sha(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)).substring(0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static double[] numbers(JsonNode a, String what) throws Invalid {
        if (!a.isArray()) throw new Invalid(what + " is missing");
        double[] out = new double[a.size()];
        for (int i = 0; i < out.length; i++) {
            JsonNode v = a.get(i);
            if (!v.isNumber() || !Double.isFinite(v.asDouble())) throw new Invalid(what + " has a value that isn’t a number");
            out[i] = v.asDouble();
        }
        return out;
    }

    private static int[] ints(JsonNode a, String what) throws Invalid {
        if (!a.isArray()) throw new Invalid(what + " is missing");
        int[] out = new int[a.size()];
        for (int i = 0; i < out.length; i++) {
            JsonNode v = a.get(i);
            if (!v.canConvertToInt()) throw new Invalid(what + " has a value that isn’t a whole number");
            out[i] = v.asInt();
        }
        return out;
    }

    /** Median filling (null: the feature was empty in training and is dropped), then the missing-value flags. */
    private record Inputs(double[] fill, boolean[] kept, int[] flags) {
        int size() {
            int k = 0;
            for (boolean b : kept) if (b) k++;
            return k + flags.length;
        }

        double[] apply(double[] x) {
            double[] out = new double[size()];
            int j = 0;
            for (int i = 0; i < kept.length; i++) {
                if (!kept[i]) continue;
                out[j++] = Double.isNaN(x[i]) ? fill[i] : x[i];
            }
            for (int f : flags) out[j++] = Double.isNaN(x[f]) ? 1.0 : 0.0;
            return out;
        }
    }

    private static Inputs inputs(JsonNode part, int n) throws Invalid {
        JsonNode fill = part.path("fill");
        if (!fill.isArray() || fill.size() != n) throw new Invalid("its filling of missing values doesn’t cover the " + n + " features");
        double[] values = new double[n];
        boolean[] kept = new boolean[n];
        for (int i = 0; i < n; i++) {
            JsonNode v = fill.get(i);
            if (v.isNull()) continue;
            if (!v.isNumber() || !Double.isFinite(v.asDouble())) throw new Invalid("its filling of missing values has a value that isn’t a number");
            values[i] = v.asDouble();
            kept[i] = true;
        }
        int[] flags = ints(part.path("flags"), "its missing-value flags");
        for (int f : flags) if (f < 0 || f >= n) throw new Invalid("a missing-value flag points at no feature");
        return new Inputs(values, kept, flags);
    }

    private static Predictor linear(JsonNode part, int n) throws Invalid {
        Inputs in = inputs(part, n);
        double[] mean = numbers(part.path("mean"), "its means");
        double[] scale = numbers(part.path("scale"), "its scales");
        double[] coef = numbers(part.path("coef"), "its coefficients");
        int m = in.size();
        if (mean.length != m || scale.length != m || coef.length != m) throw new Invalid("its formula doesn’t have one number per input");
        for (double s : scale) if (s == 0) throw new Invalid("a scale is zero");
        JsonNode i = part.path("intercept");
        if (!i.isNumber()) throw new Invalid("its intercept is missing");
        double intercept = i.asDouble();
        return x -> {
            double[] v = in.apply(x);
            double y = 0;
            for (int k = 0; k < m; k++) y += (v[k] - mean[k]) / scale[k] * coef[k];
            return intercept + y;
        };
    }

    private static Tree tree(JsonNode t, int width, boolean forest) throws Invalid {
        int[] feature = ints(t.path("feature"), "a tree's features");
        double[] threshold = numbers(t.path("threshold"), "a tree's thresholds");
        int[] left = ints(t.path("left"), "a tree's left branches");
        int[] right = ints(t.path("right"), "a tree's right branches");
        double[] value = numbers(t.path("value"), "a tree's values");
        int size = feature.length;
        if (size == 0 || threshold.length != size || left.length != size || right.length != size || value.length != size) throw new Invalid("a tree’s arrays aren’t the same length");
        boolean[] leaf = new boolean[size];
        boolean[] missingLeft = new boolean[size];
        if (forest) {
            for (int i = 0; i < size; i++) leaf[i] = left[i] == -1;
        } else {
            int[] l = ints(t.path("leaf"), "a tree's leaves");
            int[] m = ints(t.path("missing_left"), "a tree's missing-value directions");
            if (l.length != size || m.length != size) throw new Invalid("a tree’s arrays aren’t the same length");
            for (int i = 0; i < size; i++) {
                leaf[i] = l[i] != 0;
                missingLeft[i] = m[i] != 0;
            }
        }
        for (int i = 0; i < size; i++) {
            if (leaf[i]) continue;
            // Children come after their parent, so a walk always ends.
            if (left[i] <= i || right[i] <= i || left[i] >= size || right[i] >= size) throw new Invalid("a tree’s branches don’t lead forward");
            if (feature[i] < 0 || feature[i] >= width) throw new Invalid("a tree splits on a feature that doesn’t exist");
        }
        return new Tree(feature, threshold, missingLeft, left, right, leaf, value);
    }

    private static List<Tree> trees(JsonNode part, int width, boolean forest) throws Invalid {
        JsonNode list = part.path("trees");
        if (!list.isArray() || list.isEmpty()) throw new Invalid("it has no trees");
        List<Tree> out = new ArrayList<>();
        for (JsonNode t : list) out.add(tree(t, width, forest));
        return out;
    }

    /** scikit-learn's histogram gradient boosting: x <= threshold goes left; a missing value goes the way it learned. */
    private static double walkBoosted(Tree t, double[] x) {
        int i = 0;
        while (!t.leaf()[i]) {
            double v = x[t.feature()[i]];
            boolean left = Double.isNaN(v) ? t.missingLeft()[i] : v <= t.threshold()[i];
            i = left ? t.left()[i] : t.right()[i];
        }
        return t.value()[i];
    }

    private static Predictor boosted(JsonNode part, int n, int base) throws Invalid {
        JsonNode b = part.path("baseline");
        if (!b.isNumber()) throw new Invalid("its baseline is missing");
        double baseline = b.asDouble();
        List<Tree> trees = trees(part, n, false);
        return x -> {
            double y = baseline;
            for (Tree t : trees) y += walkBoosted(t, x);
            return base >= 0 ? x[base] + y : y;
        };
    }

    /** A random forest: scikit-learn compares the value as a 32-bit float, so this does too. */
    private static Predictor forest(JsonNode part, int n) throws Invalid {
        Inputs in = inputs(part, n);
        List<Tree> trees = trees(part, in.size(), true);
        return x -> {
            double[] v = in.apply(x);
            double sum = 0;
            for (Tree t : trees) {
                int i = 0;
                while (!t.leaf()[i]) {
                    double value = (float) v[t.feature()[i]];
                    i = value <= t.threshold()[i] ? t.left()[i] : t.right()[i];
                }
                sum += t.value()[i];
            }
            return sum / trees.size();
        };
    }
}
