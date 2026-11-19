# Build context: repository root (training reads ../data/raw).
FROM python:3.13-slim
WORKDIR /app/ai

COPY ai/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY data/raw /app/data/raw
COPY ai/ .
# Train here so the model always matches the installed scikit-learn.
RUN python -m training.train_forecast

# "::" listens on IPv6 and IPv4, so Railway's private network can reach it.
CMD ["sh", "-c", "uvicorn app.main:app --host :: --port ${PORT:-8000}"]
