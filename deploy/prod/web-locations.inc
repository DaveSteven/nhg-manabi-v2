# Shared by the public student site and the loopback preview (ADR-0007 routing).
location /api/ {
    proxy_pass http://127.0.0.1:8102;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
}
# 2026-11-21 user decision: the root goes straight to the learning area (302, not cached).
location = / { return 302 /study; }
# SPA routes use the noindex fallback, never the brand HTML.
location ~ ^/(study|mock|login|register|verify-email|forgot-password|reset-password)(/|$) {
    try_files /__spa-fallback.html =404;
    # HTML entry points must revalidate (ETag -> 304) so a new release is picked
    # up on the next load; hashed /assets/ stay immutable. add_header in a
    # location drops the server-level ones, so the security headers are repeated.
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
}
location / {
    try_files $uri =404;
    # HTML entry points must revalidate (ETag -> 304) so a new release is picked
    # up on the next load; hashed /assets/ stay immutable. add_header in a
    # location drops the server-level ones, so the security headers are repeated.
    add_header Cache-Control "no-cache" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
}
