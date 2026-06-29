use joblens_worker::error::WorkerResult;

#[tokio::main]
async fn main() -> WorkerResult<()> {
    joblens_worker::run().await
}
