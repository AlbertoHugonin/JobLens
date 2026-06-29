FROM rust:1.96-slim AS build

WORKDIR /app
COPY apps/worker/Cargo.toml apps/worker/Cargo.lock ./
COPY apps/worker/src src
RUN cargo build --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/target/release/joblens-worker /usr/local/bin/joblens-worker

EXPOSE 8090
CMD ["joblens-worker"]
