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


def _migrate_drop_unique_name_index(conn: sqlite3.Connection) -> None:
    indexes = {row["name"] for row in conn.execute("PRAGMA index_list(children)").fetchall()}
    if "idx_children_unique_profile_per_expert" in indexes:
        conn.execute("DROP INDEX idx_children_unique_profile_per_expert")
        conn.commit()


def _migrate_add_interaction_mode(conn: sqlite3.Connection) -> None:
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(children)").fetchall()}
    if "interaction_mode" not in cols:
        conn.execute(
            "ALTER TABLE children ADD COLUMN interaction_mode TEXT NOT NULL DEFAULT 'flexible'"
        )
        conn.commit()
        
def _migrate_add_parent_id(conn: sqlite3.Connection) -> None:
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(children)").fetchall()}
    if "parent_id" not in cols:
        conn.execute(
            "ALTER TABLE children ADD COLUMN parent_id TEXT NULL REFERENCES parents(parent_id) ON UPDATE CASCADE ON DELETE SET NULL"
        )
        conn.commit()


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
                interaction_mode TEXT NOT NULL DEFAULT 'flexible',
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
            
            CREATE TABLE IF NOT EXISTS parents(
                parent_id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                login_code_hash TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN(0,1)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_parents_active
                ON parents (is_active);


            """

            

        )
        _migrate_children_for_unlink(conn)
        _migrate_add_interaction_mode(conn)
        _migrate_drop_unique_name_index(conn)
        _migrate_add_parent_id(conn)
        conn.commit()
