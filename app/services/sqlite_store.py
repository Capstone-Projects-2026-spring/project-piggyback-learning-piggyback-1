import sqlite3
from pathlib import Path

from app.settings import SQLITE_PATH
    #Opens a Database connection
def get_conn() -> sqlite3.Connection:
    # Ensure the DB directory exists before opening the SQLite file.
    db_path = Path(SQLITE_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # row_factory lets us access columns by name (row["expert_id"])
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def _children_needs_unlink_migration(conn: sqlite3.Connection) -> bool:
    rows = conn.execute("PRAGMA table_info(children)").fetchall()
    if not rows:
        return False
    for row in rows:
        if row["name"] == "expert_id":
            # old schema had NOT NULL expert_id, new schema allows NULL for unlink
            return bool(row["notnull"])
    return False


def _migrate_children_for_unlink(conn: sqlite3.Connection) -> None:
    if not _children_needs_unlink_migration(conn):
        return

    conn.execute("PRAGMA foreign_keys = OFF;")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS children_new(
            child_id TEXT PRIMARY KEY
            CHECK(
                length(child_id) = 6
                AND child_id GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
            ),
            expert_id TEXT NULL,
            first_name TEXT NOT NULL,
            last_name TEXT NOT NULL,
            icon_key TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(expert_id) REFERENCES experts(expert_id)
                ON UPDATE CASCADE
                ON DELETE SET NULL
        );

        INSERT INTO children_new
        (child_id, expert_id, first_name, last_name, icon_key, is_active, created_at, updated_at)
        SELECT
            child_id, expert_id, first_name, last_name, icon_key, is_active, created_at, updated_at
        FROM children;

        DROP TABLE children;
        ALTER TABLE children_new RENAME TO children;

        CREATE INDEX IF NOT EXISTS idx_children_expert_id
            ON children (expert_id);

        CREATE INDEX IF NOT EXISTS idx_children_active_expert
            ON children (expert_id, is_active);

        CREATE UNIQUE INDEX IF NOT EXISTS idx_children_unique_profile_per_expert
            ON children (
                expert_id,
                lower(trim(first_name)),
                lower(trim(last_name))
            );
        """
    )
    conn.execute("PRAGMA foreign_keys = ON;")


def init_db() -> None:
    #creates table on start up 
    with get_conn() as conn:
        # Idempotent bootstrap: safe to run at every app startup. from documentation
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS experts (
                expert_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS videos(
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                thumbnail TEXT,
                duration FLOAT DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS video_data_id
                ON videos (id);

            CREATE TABLE IF NOT EXISTS video_assignments (
                video_id TEXT PRIMARY KEY,
                expert_id TEXT NULL,
                assignment_source TEXT NOT NULL CHECK (assignment_source IN ('admin', 'expert_claim', 'unassigned')),
                assigned_at TEXT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (expert_id) REFERENCES experts(expert_id)
                    ON UPDATE CASCADE
                    ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_video_assignments_expert_id
                ON video_assignments (expert_id);

            CREATE TABLE IF NOT EXISTS video_expert_assignments(
            
                video_id TEXT NOT NULL,
                expert_id TEXT NOT NULL,
                assignment_source TEXT NOT NULL CHECK(assignment_source IN ('admin', 'expert_claim', 'unassigned')),
                assigned_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (video_id, expert_id),
                FOREIGN KEY (expert_id) REFERENCES experts(expert_id)
                ON UPDATE CASCADE
                ON DELETE CASCADE 
            );

            CREATE INDEX IF NOT EXISTS idx_video_expert_assignments_video_id
            ON video_expert_assignments (video_id);

            CREATE INDEX IF NOT EXISTS idx_video_expert_assignments_expert_id
                ON video_expert_assignments (expert_id);


            INSERT OR IGNORE INTO video_expert_assignments
            (video_id,expert_id,assignment_source,assigned_at,updated_at)
            SELECT
                video_id,
                expert_id,
                COALESCE(NULLIF(assignment_source, ''), 'admin'),
                COALESCE(assigned_at, updated_at),
                updated_at
            FROM video_assignments
            WHERE expert_id IS NOT NULL;

            CREATE TABLE IF NOT EXISTS children(
                child_id TEXT PRIMARY KEY
                CHECK(
                    length(child_id) = 6
                    AND child_id GLOB '[0-9][0-9][0-9][0-9][0-9][0-9]'
                ),
                expert_id TEXT NULL,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                icon_key TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(expert_id) REFERENCES experts(expert_id)
                    ON UPDATE CASCADE
                    ON DELETE SET NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_children_expert_id
                ON children (expert_id);
            
            CREATE INDEX IF NOT EXISTS idx_children_active_expert
                ON children (expert_id, is_active);            
            
            CREATE UNIQUE INDEX IF NOT EXISTS idx_children_unique_profile_per_expert
                ON children (
                expert_id,
                lower(trim(first_name)),
                lower(trim(last_name))
            );

            CREATE TABLE IF NOT EXISTS quiz_attempts(

                attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id TEXT NOT NULL,
                child_id TEXT NOT NULL,
                timestamp TEXT,
                total_questions INT,
                correct INT,
                incorrect INT,
                percentage FLOAT,
                FOREIGN KEY (video_id) REFERENCES video_assignments(video_id),
                FOREIGN KEY (child_id) REFERENCES children(child_id)
            );

            """

            

        )
        _migrate_children_for_unlink(conn)
        conn.commit()
