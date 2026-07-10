# start_server.ps1
Set-Location -LiteralPath 'C:\Users\Rafael\SeaSID\backend'
python -m uvicorn app.api.main:app --host 127.0.0.1 --port 8765 --log-level info