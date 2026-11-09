param([int]$Port = 8731, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port must be 1024-65535.' }
$siteRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$routes = @{
    '/' = @('index.html', 'text/html; charset=utf-8')
    '/index.html' = @('index.html', 'text/html; charset=utf-8')
    '/style.css' = @('style.css', 'text/css; charset=utf-8')
    '/layout.js' = @('layout.js', 'text/javascript; charset=utf-8')
    '/core.js' = @('core.js', 'text/javascript; charset=utf-8')
    '/app.js' = @('app.js', 'text/javascript; charset=utf-8')
}
$server = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $server.Start() } catch { throw "Cannot listen on 127.0.0.1:$Port. Port may be occupied. Close the old Light Lab window, or run with -Port 8732. $($_.Exception.Message)" }
$siteUrl = "http://127.0.0.1:$Port/"
Write-Host "HERO99HE Light Lab - $siteUrl" -ForegroundColor Magenta
Write-Host 'Preview only by default. Hardware requires Chrome / Edge and an explicit Connect + Start.'
Write-Host 'Keep this window open. Ctrl+C stops the local server. The original port 8720 is unchanged.'
if (-not $NoBrowser) {
    $edgePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'
    if (Test-Path -LiteralPath $edgePath) { Start-Process -FilePath $edgePath -ArgumentList $siteUrl }
    else { Start-Process $siteUrl }
}
try {
    while ($true) {
        $client = $server.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $stream.ReadTimeout = 4000
            $stream.WriteTimeout = 4000
            $requestBytes = [System.Collections.Generic.List[byte]]::new()
            while ($requestBytes.Count -lt 8192) {
                $nextByte = $stream.ReadByte()
                if ($nextByte -lt 0) { break }
                $requestBytes.Add([byte]$nextByte)
                $n = $requestBytes.Count
                if ($n -ge 4 -and $requestBytes[$n - 4] -eq 13 -and $requestBytes[$n - 3] -eq 10 -and $requestBytes[$n - 2] -eq 13 -and $requestBytes[$n - 1] -eq 10) { break }
            }
            $request = [System.Text.Encoding]::ASCII.GetString($requestBytes.ToArray())
            $lines = $request -split "`r`n"
            $firstLine = $lines[0] -split ' '
            $method = $firstLine[0]
            $target = if ($firstLine.Length -ge 2) { ($firstLine[1] -split '\?')[0] } else { '' }
            $hostLine = $lines | Where-Object { $_ -match '^Host:' } | Select-Object -First 1
            $requestHost = if ($hostLine) { ($hostLine -replace '^Host:\s*', '').Trim().ToLowerInvariant() } else { '' }
            $status = '200 OK'; $mime = 'text/plain; charset=utf-8'; $body = [byte[]]@()
            if ($requestHost -notin @("127.0.0.1:$Port", "localhost:$Port")) {
                $status = '403 Forbidden'; $body = [System.Text.Encoding]::UTF8.GetBytes('Localhost requests only.')
            } elseif ($method -notin @('GET', 'HEAD')) {
                $status = '405 Method Not Allowed'; $body = [System.Text.Encoding]::UTF8.GetBytes('Read-only static server.')
            } elseif (-not $routes.ContainsKey($target)) {
                $status = '404 Not Found'; $body = [System.Text.Encoding]::UTF8.GetBytes('Not found.')
            } else {
                $route = $routes[$target]
                $body = [System.IO.File]::ReadAllBytes((Join-Path $siteRoot $route[0]))
                $mime = $route[1]
            }
            $headers = "HTTP/1.1 $status`r`nContent-Type: $mime`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nReferrer-Policy: no-referrer`r`nPermissions-Policy: hid=(self), camera=(), microphone=(), geolocation=()`r`nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`r`n`r`n"
            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
            $stream.Write($headerBytes, 0, $headerBytes.Length)
            if ($method -ne 'HEAD') { $stream.Write($body, 0, $body.Length) }
            $stream.Flush()
        } catch { Write-Verbose $_.Exception.Message }
        finally { $client.Close() }
    }
} finally { $server.Stop() }
