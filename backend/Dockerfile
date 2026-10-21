# Container build for hosting the backend (Railway, Render, Fly.io and similar).
# Local development doesn't need it: use ./mvnw spring-boot:run as the README says.

# 1. Build the jar with Maven and JDK 21.
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -B -q -DskipTests package && cp target/projectflow-backend-*.jar /app.jar

# 2. Run it on a small Java 21 runtime, as a non-root user.
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 projectflow && mkdir -p /app/data/uploads && chown -R projectflow /app
COPY --from=build /app.jar /app/app.jar
USER projectflow
# Uploaded evidence goes here. Attach a persistent volume at /app/data if the host offers one,
# or uploads are lost when the service is redeployed.
ENV STORAGE_DIR=/app/data/uploads \
    JAVA_OPTS="-XX:MaxRAMPercentage=75"
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/app.jar"]
