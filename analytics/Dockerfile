FROM python:3.12-slim
WORKDIR /app
COPY analytics/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY analytics ./analytics
COPY scripts/analysis-sync.py ./scripts/analysis-sync.py
ENV ANALYTICS_ENV=production PYTHONUNBUFFERED=1
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8091/health',timeout=3)"
CMD ["python", "-m", "uvicorn", "analytics.app:app", "--host", "0.0.0.0", "--port", "8091", "--workers", "1"]
