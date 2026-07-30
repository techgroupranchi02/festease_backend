#!/usr/bin/env python3
"""
generate_qr_local.py
--------------------
Locally generates branded QR codes (with BISFF logo in centre) for every row
in the saas_qr table, then bundles them into QR.zip.

Usage
-----
    python3 generate_qr_local.py
    python3 generate_qr_local.py --output /tmp/QR.zip
    python3 generate_qr_local.py --logo assets/bisff_logo.png --size 800
    python3 generate_qr_local.py --no-logo

One-time setup (on the server or locally):
    pip install pyseto qrcode pillow mysql-connector-python --break-system-packages

How it mirrors the Node.js server logic
----------------------------------------
1. Reads every row from saas_qr  (qr_id, qr_data, attendee_id)
2. Encrypts the payload with PASETO v4 local using the same PASETO_LOCAL_KEY
   → produces the exact same token the server would produce
3. Renders the token as a QR code (error-correction H so the logo is safe)
4. Composites the logo at 22 % of QR width in the centre
5. Saves each image as <qr_data>.png inside QR/  within the ZIP

Memory note:  images are kept as BytesIO buffers; no temp files are written.
"""

import argparse
import base64
import io
import json
import os
import sys
import zipfile
from pathlib import Path

import mysql.connector
import pyseto
import qrcode
from PIL import Image

# ---------------------------------------------------------------------------
# Configuration — read from environment (same values as .env)
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent

DB_CONFIG = {
    "host":        os.getenv("DB_HOST",     "147.93.105.85"),
    "port":        int(os.getenv("DB_PORT", "3306")),
    "database":    os.getenv("DB_DATABASE", "freecomers_database"),
    "user":        os.getenv("DB_USERNAME", "root"),
    "password":    os.getenv("DB_PASSWORD", "Root@12345"),
    "ssl_disabled": True,   # mysql-connector-python ssl.wrap_socket removed in Python 3.12+
}

PASERK = os.getenv(
    "PASETO_LOCAL_KEY",
    "k4.local.MfKRbhrKT3uJHvXzoC5iygI8XVq4sUlCFLLwJte_ETs",
)

DEFAULT_LOGO = str(SCRIPT_DIR / "assets" / "bisff_logo.png")


# ---------------------------------------------------------------------------
# PASETO v4 local helpers
# ---------------------------------------------------------------------------
def _load_paseto_key(paserk: str) -> pyseto.Key:
    """Convert a PASERK k4.local.xxx string into a pyseto Key object."""
    if not paserk.startswith("k4.local."):
        raise ValueError("PASETO_LOCAL_KEY must start with 'k4.local.'")
    raw_b64 = paserk.split(".", 2)[2]
    padding = (4 - len(raw_b64) % 4) % 4
    raw_key = base64.urlsafe_b64decode(raw_b64 + "=" * padding)
    return pyseto.Key.new(version=4, purpose="local", key=raw_key)


def encrypt_qr_payload(key: pyseto.Key, payload: dict) -> str:
    """Encrypt a dict payload as a PASETO v4 local token string."""
    token_bytes = pyseto.encode(
        key,
        json.dumps(payload, separators=(",", ":")).encode()
    )
    return token_bytes.decode()


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def fetch_all_qr_rows(cfg: dict) -> list:
    """Return every row from saas_qr ordered by qr_id ASC."""
    conn = mysql.connector.connect(**cfg)
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute(
            "SELECT qr_id, qr_data, attendee_id "
            "FROM saas_qr ORDER BY qr_id ASC"
        )
        rows = cur.fetchall()
        cur.close()
        return rows
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# QR + logo compositor
# ---------------------------------------------------------------------------
def make_qr_with_logo(
    token: str,
    logo_path,      # str | None
    qr_size: int = 600,
) -> Image.Image:
    """
    Render a PASETO token as a QR code and overlay a logo in the centre.

    Error-correction level H allows up to ~30 % of modules to be obscured,
    which is more than enough for a centre logo at 22 % of image width.
    """
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=2,
    )
    qr.add_data(token)
    qr.make(fit=True)

    qr_img = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    qr_img = qr_img.resize((qr_size, qr_size), Image.LANCZOS)

    if logo_path and Path(logo_path).exists():
        logo = Image.open(logo_path).convert("RGBA")

        # Keep logo at ≤22 % of QR width
        logo_max = int(qr_size * 0.22)
        logo.thumbnail((logo_max, logo_max), Image.LANCZOS)
        lw, lh = logo.size

        # Add white padding ring for contrast
        pad = 8
        canvas = Image.new("RGBA", (lw + pad * 2, lh + pad * 2), (255, 255, 255, 255))
        canvas.paste(logo, (pad, pad), mask=logo)
        cw, ch = canvas.size

        # Paste centred
        cx = (qr_size - cw) // 2
        cy = (qr_size - ch) // 2
        qr_img.paste(canvas, (cx, cy), mask=canvas)

    return qr_img


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description=(
            "Generate branded QR codes (BISFF logo in centre) for all "
            "saas_qr rows and pack them into a ZIP archive."
        )
    )
    parser.add_argument(
        "--output", "-o",
        default="QR.zip",
        help="Output ZIP file path (default: QR.zip)",
    )
    parser.add_argument(
        "--logo", "-l",
        default=DEFAULT_LOGO,
        help=f"Path to logo PNG (default: {DEFAULT_LOGO})",
    )
    parser.add_argument(
        "--size", "-s",
        type=int,
        default=600,
        help="QR image size in pixels (default: 600)",
    )
    parser.add_argument(
        "--no-logo",
        action="store_true",
        help="Skip logo overlay and produce plain black-and-white QR codes",
    )
    args = parser.parse_args()

    logo_path = None if args.no_logo else args.logo

    # ── 1. PASETO key ────────────────────────────────────────────────────────
    print("[*] Loading PASETO key …")
    try:
        key = _load_paseto_key(PASERK)
    except Exception as exc:
        print(f"[!] Failed to load PASETO key: {exc}", file=sys.stderr)
        sys.exit(1)

    # ── 2. Fetch DB rows ─────────────────────────────────────────────────────
    print(f"[*] Connecting to {DB_CONFIG['host']}:{DB_CONFIG['port']} …")
    try:
        rows = fetch_all_qr_rows(DB_CONFIG)
    except Exception as exc:
        print(f"[!] Database error: {exc}", file=sys.stderr)
        sys.exit(1)

    if not rows:
        print("[!] saas_qr table is empty — nothing to do.", file=sys.stderr)
        sys.exit(1)

    print(f"[*] {len(rows)} record(s) found.")

    if logo_path:
        if Path(logo_path).exists():
            print(f"[*] Logo: {logo_path}")
        else:
            print(f"[!] Logo not found at '{logo_path}' — skipping logo overlay.")
            logo_path = None

    # ── 3. Build ZIP in memory ────────────────────────────────────────────────
    output_path = Path(args.output)
    print(f"[*] Writing → {output_path} …")

    with zipfile.ZipFile(
        output_path, "w",
        compression=zipfile.ZIP_DEFLATE if hasattr(zipfile, 'ZIP_DEFLATE') else zipfile.ZIP_DEFLATED,
        compresslevel=6,
    ) as zf:
        for i, row in enumerate(rows, start=1):
            # Build payload identical to Node.js encryptQrPayload call
            payload = {
                "qr_id":       row["qr_id"],
                "qr_data":     row["qr_data"],
                "attendee_id": row["attendee_id"],
            }
            token = encrypt_qr_payload(key, payload)

            img = make_qr_with_logo(token, logo_path, qr_size=args.size)

            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            buf.seek(0)

            zf.writestr(f"QR/{row['qr_data']}.png", buf.getvalue())

            # Progress every 10 or on last item
            if i % 10 == 0 or i == len(rows):
                print(f"    {i}/{len(rows)} …", end="\r", flush=True)

    size_kb = output_path.stat().st_size / 1024
    print(f"\n[✓] Done!  {len(rows)} QR code(s)  →  {output_path}  ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
