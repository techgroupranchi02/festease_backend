#!/usr/bin/env python3
"""
insert_saas_qr.py
-----------------
Script to insert sequential QR entries into the saas_qr database table.
 
Interactive Mode:
  When run directly without flags, it interactively prompts the user for:
    - Number of QR entries to enter (data_to_enter) [default: 500]
    - festival_id [default: 298]
    - event_id [default: 309]
    - QR prefix [default: 'BISFF2026-']
 
CLI Flags:
  python3 pythonCodes/insert_saas_qr.py --count 500 --event-id 309 --festival-id 298
"""
 
import argparse
import os
import re
import sys
from pathlib import Path
import mysql.connector
 
def _load_env_file():
    """Loads environment variables from .env file into os.environ if available."""
    script_dir = Path(__file__).resolve().parent
    env_paths = [
        script_dir / ".env",
        script_dir.parent / ".env",
        Path.cwd() / ".env",
    ]
    for env_path in env_paths:
        if env_path.is_file():
            try:
                with open(env_path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" in line:
                            key, val = line.split("=", 1)
                            key = key.strip()
                            val = val.strip()
                            if (val.startswith("'") and val.endswith("'")) or (val.startswith('"') and val.endswith('"')):
                                val = val[1:-1]
                            os.environ.setdefault(key, val)
                break
            except Exception:
                pass
 
 
_load_env_file()
 
# Database connection settings from environment or default project credentials
DB_CONFIG = {
    "host":        os.getenv("DB_HOST",     "31.97.239.167"),
    "port":        int(os.getenv("DB_PORT", "3306")),
    "database":    os.getenv("DB_DATABASE", "freecomers_database"),
    "user":        os.getenv("DB_USERNAME", "freecomers_username"),
    "password":    os.getenv("DB_PASSWORD", "3ab@4N#jdC2uC"),
    "ssl_disabled": True,
}
 
 
def get_next_start_number(cursor, prefix="BISFF2026-", default_start=11001):
    """Finds the next starting integer suffix for qr_data matching the prefix."""
    cursor.execute("SELECT qr_data FROM saas_qr WHERE qr_data LIKE %s ORDER BY qr_id DESC LIMIT 100", (f"{prefix}%",))
    rows = cursor.fetchall()
    max_num = 0
    pattern = re.compile(rf"^{re.escape(prefix)}(\d+)$")
    for (qr_data,) in rows:
        match = pattern.match(qr_data)
        if match:
            num = int(match.group(1))
            if num > max_num:
                max_num = num
 
    if max_num >= default_start:
        return max_num + 1
    return default_start
 
 
def insert_qr_records(data_to_enter=500, event_id=309, festival_id=298, prefix="BISFF2026-", start_number=None, qr_id_start=None, qr_id_end=None):
    """Inserts batch of sequential QR codes into saas_qr table."""
    print(f"\n🔌 Connecting to MySQL database '{DB_CONFIG['database']}' at {DB_CONFIG['host']}...")
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()
 
    try:
        if qr_id_start is not None and qr_id_end is not None:
            if qr_id_end < qr_id_start:
                raise ValueError(f"qr_id_end ({qr_id_end}) must be greater than or equal to qr_id_start ({qr_id_start}).")
 
            # Check if any qr_id in the range already exists in saas_qr table
            cursor.execute(
                "SELECT qr_id FROM saas_qr WHERE qr_id BETWEEN %s AND %s ORDER BY qr_id ASC LIMIT 100",
                (qr_id_start, qr_id_end)
            )
            existing_rows = cursor.fetchall()
            if existing_rows:
                existing_ids = [r[0] for r in existing_rows]
                err_msg = (
                    f"❌ Error: Range already exists in database!\n"
                    f"   Found {len(existing_rows)} existing record(s) in qr_id range {qr_id_start} to {qr_id_end}.\n"
                    f"   Sample existing qr_id(s): {existing_ids[:10]}\n"
                    f"   Aborting insertion. No records were added."
                )
                print(f"\n{err_msg}", file=sys.stderr)
                return 0
 
            # Set data_to_enter equal to the qr_id range length
            data_to_enter = qr_id_end - qr_id_start + 1
 
        if start_number is None:
            start_number = get_next_start_number(cursor, prefix=prefix, default_start=11001)
 
        end_number = start_number + data_to_enter - 1
 
        # Check if any qr_data in the generated range already exists in saas_qr table
        qr_data_to_check = [f"{prefix}{i}" for i in range(start_number, end_number + 1)]
        existing_qr_data = []
        batch_check_size = 500
        for i in range(0, len(qr_data_to_check), batch_check_size):
            batch = qr_data_to_check[i:i + batch_check_size]
            placeholders = ','.join(['%s'] * len(batch))
            cursor.execute(f"SELECT qr_data FROM saas_qr WHERE qr_data IN ({placeholders})", tuple(batch))
            rows = cursor.fetchall()
            if rows:
                existing_qr_data.extend([r[0] for r in rows])
 
        if existing_qr_data:
            err_msg = (
                f"❌ Error: QR code data already exists in database!\n"
                f"   Found {len(existing_qr_data)} existing record(s) matching qr_data range.\n"
                f"   Sample existing qr_data: {existing_qr_data[:10]}\n"
                f"   Aborting insertion. No records were added."
            )
            print(f"\n{err_msg}", file=sys.stderr)
            return 0
 
        print(f"📊 Preparing to insert {data_to_enter} QR records:")
        print(f"   - Prefix:       '{prefix}'")
        print(f"   - Range:        {prefix}{start_number}  to  {prefix}{end_number}")
        if qr_id_start is not None and qr_id_end is not None:
            print(f"   - qr_id Range:  {qr_id_start}  to  {qr_id_end}")
        print(f"   - event_id:     {event_id}")
        print(f"   - festival_id:  {festival_id}")
 
        if qr_id_start is not None and qr_id_end is not None:
            sql = """
                INSERT INTO saas_qr (qr_id, qr_data, event_id, festival_id, attendee_id)
                VALUES (%s, %s, %s, %s, NULL)
            """
            records = []
            current_qr_id = qr_id_start
            for i in range(start_number, end_number + 1):
                qr_code_str = f"{prefix}{i}"
                records.append((current_qr_id, qr_code_str, event_id, festival_id))
                current_qr_id += 1
        else:
            sql = """
                INSERT INTO saas_qr (qr_data, event_id, festival_id, attendee_id)
                VALUES (%s, %s, %s, NULL)
            """
            records = []
            for i in range(start_number, end_number + 1):
                qr_code_str = f"{prefix}{i}"
                records.append((qr_code_str, event_id, festival_id))
 
        batch_size = 100
        total_inserted = 0
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            cursor.executemany(sql, batch)
            conn.commit()
            total_inserted += len(batch)
            print(f"   ✅ Inserted batch {i + 1} to {i + len(batch)} ({total_inserted}/{data_to_enter})")
 
        print(f"\n🎉 Successfully inserted {total_inserted} QR entries into saas_qr table!")
        print(f"   First QR: {prefix}{start_number}")
        print(f"   Last QR:  {prefix}{end_number}")
        if qr_id_start is not None and qr_id_end is not None:
            print(f"   First qr_id: {qr_id_start}")
            print(f"   Last qr_id:  {qr_id_end}")
        return total_inserted
 
    except Exception as e:
        conn.rollback()
        print(f"\n❌ Error during insertion: {e}", file=sys.stderr)
        raise
    finally:
        cursor.close()
        conn.close()
 
 
def prompt_user_input():
    """Interactively prompts the user for configuration values with default fallbacks."""
    print("==================================================")
    print("       saas_qr Sequential Entry Generator         ")
    print("==================================================")
   
    # 1. festival_id
    fest_val = None
    while fest_val is None:
        raw = input("Enter festival_id [default: 298]: ").strip()
        if not raw:
            fest_val = 298
        else:
            try:
                fest_val = int(raw)
            except ValueError:
                print("⚠️ Please enter a valid integer for festival_id.")
 
    # 2. event_id
    event_val = None
    while event_val is None:
        raw = input("Enter event_id [default: 309]: ").strip()
        if not raw:
            event_val = 309
        else:
            try:
                event_val = int(raw)
            except ValueError:
                print("⚠️ Please enter a valid integer for event_id.")
 
    # 3. QR prefix
    raw_prefix = input("Enter QR prefix [default: BISFF2026-]: ").strip()
    prefix_val = raw_prefix if raw_prefix else "BISFF2026-"
 
    # 4. Optional explicit start number for QR data string
    start_val = None
    raw_start = input("Enter starting QR number (press Enter for auto-detect e.g., 11001): ").strip()
    if raw_start:
        try:
            start_val = int(raw_start)
        except ValueError:
            print("⚠️ Invalid start number, defaulting to auto-detect.")
 
    # 5. Optional explicit qr_id start and end
    qr_id_start = None
    qr_id_end = None
    count_val = None
 
    ans_qr_id = input("Would you want to insert qr_id also? (y/n) [default: n]: ").strip().lower()
    if ans_qr_id in ['y', 'yes']:
        while qr_id_start is None:
            raw_qstart = input("Enter starting qr_id (e.g. 1001): ").strip()
            try:
                qr_id_start = int(raw_qstart)
                if qr_id_start <= 0:
                    print("⚠️ Starting qr_id must be greater than 0.")
                    qr_id_start = None
            except ValueError:
                print("⚠️ Please enter a valid integer for starting qr_id.")
 
        while qr_id_end is None:
            raw_qend = input("Enter ending qr_id (e.g. 1500): ").strip()
            try:
                qr_id_end = int(raw_qend)
                if qr_id_end < qr_id_start:
                    print("⚠️ Ending qr_id must be greater than or equal to starting qr_id.")
                    qr_id_end = None
            except ValueError:
                print("⚠️ Please enter a valid integer for ending qr_id.")
 
        # Count is automatically derived from qr_id range (start to end)
        count_val = qr_id_end - qr_id_start + 1
    else:
        # Ask count prompt only if qr_id range is NOT entered
        while count_val is None:
            raw = input("Enter number of data to enter (count) [default: 500]: ").strip()
            if not raw:
                count_val = 500
            else:
                try:
                    count_val = int(raw)
                    if count_val <= 0:
                        print("⚠️ Count must be greater than 0.")
                        count_val = None
                except ValueError:
                    print("⚠️ Please enter a valid integer for count.")
 
    return count_val, event_val, fest_val, prefix_val, start_val, qr_id_start, qr_id_end
 
 
def main():
    parser = argparse.ArgumentParser(description="Insert sequential QR records into saas_qr table.")
    parser.add_argument("--count", "-c", type=int, default=None, help="Number of records to insert")
    parser.add_argument("--event-id", type=int, default=None, help="event_id value")
    parser.add_argument("--festival-id", type=int, default=None, help="festival_id value")
    parser.add_argument("--prefix", type=str, default=None, help="QR data prefix (e.g. 'BISFF2026-')")
    parser.add_argument("--start", type=int, default=None, help="Explicit starting number")
    parser.add_argument("--qr-id-start", type=int, default=None, help="Explicit starting qr_id")
    parser.add_argument("--qr-id-end", type=int, default=None, help="Explicit ending qr_id")
    parser.add_argument("--non-interactive", action="store_true", help="Run with default values without asking interactive prompts")
 
    args = parser.parse_args()
 
    # Check if CLI flags were explicitly provided
    has_cli_args = any(arg is not None for arg in [args.count, args.event_id, args.festival_id, args.prefix, args.start, args.qr_id_start, args.qr_id_end])
 
    if has_cli_args or args.non_interactive or not sys.stdin.isatty():
        count = args.count if args.count is not None else 500
        event_id = args.event_id if args.event_id is not None else 309
        festival_id = args.festival_id if args.festival_id is not None else 298
        prefix = args.prefix if args.prefix is not None else "BISFF2026-"
        start = args.start
        qr_id_start = args.qr_id_start
        qr_id_end = args.qr_id_end
    else:
        count, event_id, festival_id, prefix, start, qr_id_start, qr_id_end = prompt_user_input()
 
    insert_qr_records(
        data_to_enter=count,
        event_id=event_id,
        festival_id=festival_id,
        prefix=prefix,
        start_number=start,
        qr_id_start=qr_id_start,
        qr_id_end=qr_id_end
    )
 
 
if __name__ == "__main__":
    main()