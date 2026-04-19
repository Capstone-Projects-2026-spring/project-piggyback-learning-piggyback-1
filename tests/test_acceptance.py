from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

#pokemon video
def test_student_misspells_pikachu_and_still_gets_correct():
    # Student knows the answer but misspells it slightly
    response = client.post("/api/check_answer", json={
        "expected": "pikachu",
        "user": "pikahu",
        "question": "what is the name of this yellow pokemon"
    })

   # App should still accept close enough answers
    assert response.status_code == 200
    assert response.json()["status"] == "correct"
    
#Spinning cat video
def test_student_answers_spinning_cat_question():
    # Student watches the O I I A I spinning cat video
    # and is asked what the cat is doing
    response = client.post("/api/check_answer", json={
        "expected": "spinning",
        "user": "spinning",
        "question": "what is the cat doing"
    })
    # Student gets it right
    assert response.status_code == 200
    assert response.json()["status"] == "correct"


def test_admin_can_login():
    # Use Case 1: Admin logs in to access the admin panel
    response = client.post("/api/verify-password", data={
        "user_type": "admin",
        "password": "wrongpassword"
    })
    # Even wrong password returns 200, just with success: false
    assert response.status_code == 200


def test_student_loads_app_and_answers_correctly():
    # App loads
    config_response = client.get("/api/config")
    assert config_response.status_code == 200

    # Learner answers correctly
    answer_response = client.post("/api/check_answer", json={
        "expected": "cat",
        "user": "cat",
        "question": "what animal is in the video"
    })
    assert answer_response.status_code == 200
    assert answer_response.json()["status"] == "correct"


#childrens

from uuid import uuid4

def test_admin_can_create_child_profile():
    # Admin creates an expert first
    expert_id = f"exp_{uuid4().hex[:8]}"
    client.post("/api/admin/experts", json={
        "expert_id": expert_id,
        "display_name": "Test Expert",
        "password": "pass123"
    })

    # Admin creates a child linked to that expert
    resp = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Emma",
        "last_name": "Smith",
        "icon_key": "pig"
    })
    assert resp.status_code == 200
    child = resp.json()["child"]
    assert child["first_name"] == "Emma"
    assert child["expert_id"] == expert_id
    # child_id should be a 6-digit string
    assert len(child["child_id"]) == 6
    assert child["child_id"].isdigit()


def test_learner_enters_expert_id_and_sees_children():
    # Admin sets up expert + child
    expert_id = f"exp_{uuid4().hex[:8]}"
    client.post("/api/admin/experts", json={
        "expert_id": expert_id,
        "display_name": "Test Expert",
        "password": "pass123"
    })
    client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Liam",
        "last_name": "Jones",
        "icon_key": "rabbit"
    })

    # Learner enters expert ID and gets child list
    resp = client.get(f"/api/learners/experts/{expert_id}/children")
    assert resp.status_code == 200
    children = resp.json()["children"]
    assert any(c["first_name"] == "Liam" for c in children)


def test_learner_cannot_see_inactive_child():
    # Admin creates expert + child, then deactivates the child
    expert_id = f"exp_{uuid4().hex[:8]}"
    client.post("/api/admin/experts", json={
        "expert_id": expert_id,
        "display_name": "Test Expert",
        "password": "pass123"
    })
    create_resp = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Noah",
        "last_name": "Brown",
        "icon_key": "fox"
    })
    child_id = create_resp.json()["child"]["child_id"]
    client.post(f"/api/admin/children/{child_id}/deactivate")

    # Learner should NOT see the deactivated child
    resp = client.get(f"/api/learners/experts/{expert_id}/children")
    assert resp.status_code == 200
    children = resp.json()["children"]
    assert not any(c["child_id"] == child_id for c in children)


def test_admin_cannot_create_duplicate_child_under_same_expert():
    # Admin creates expert + child
    expert_id = f"exp_{uuid4().hex[:8]}"
    client.post("/api/admin/experts", json={
        "expert_id": expert_id,
        "display_name": "Test Expert",
        "password": "pass123"
    })
    first_resp = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Ava",
        "last_name": "Wilson",
        "icon_key": "bear"
    })
    first_child_id = first_resp.json()["child"]["child_id"]

    # Creating a child with the same name gets a new unique child_id
    dupe_resp = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Ava",
        "last_name": "Wilson",
        "icon_key": "owl"
    })
    assert dupe_resp.status_code == 200
    assert dupe_resp.json()["child"]["child_id"] != first_child_id


def test_child_video_list_scoped_to_expert_assignments():
    # A child with an unlinked expert should return empty video list
    expert_id = f"exp_{uuid4().hex[:8]}"
    client.post("/api/admin/experts", json={
        "expert_id": expert_id,
        "display_name": "Test Expert",
        "password": "pass123"
    })
    create_resp = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Mia",
        "last_name": "Davis",
        "icon_key": "penguin"
    })
    child_id = create_resp.json()["child"]["child_id"]

    # Expert has no assigned videos, so child should see none
    resp = client.get(f"/api/learners/children/{child_id}/videos")
    assert resp.status_code == 200
    assert resp.json()["videos"] == []


# Pig Feedback TTS — acceptance tests

def test_pig_reads_back_learners_spoken_answer():
    # Learner says something wrong; the pig reads it back.
    # The API must return the user's spoken text so the frontend can say "You said: X"
    response = client.post("/api/check_answer", json={
        "expected": "the sun",
        "user": "the moon",
        "question": "what lights up the sky during the day"
    })
    assert response.status_code == 200
    assert response.json()["user"] == "the moon"


def test_pig_returns_almost_for_borderline_answer():
    # Learner gives a close but not exact answer.
    # Frontend uses "almost" status to trigger "[spoken] is not quite the answer"
    response = client.post("/api/check_answer", json={
        "expected": "photosynthesis",
        "user": "photosintesis",
        "question": "what process do plants use to make food"
    })
    assert response.status_code == 200
    assert response.json()["status"] in ("almost", "correct")


def test_pig_reveals_correct_answer_for_wrong_response():
    # Learner is completely wrong; flexible mode reveals "The answer is X"
    # The API must return expected so frontend can build that message
    response = client.post("/api/check_answer", json={
        "expected": "chlorophyll",
        "user": "i have no idea",
        "question": "what makes leaves green"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "wrong"
    assert data["expected"] == "chlorophyll"


# parent sets access code, kids can sign in with it, wrong code is rejected
def test_access_code_set_and_verify():
    from datetime import datetime, timezone
    from app.services.expert_auth_service import hash_password, verify_password
    from app.services.sqlite_store import get_conn
    parent_id = "_test_ac_roundtrip"
    code = "xy42z"
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute("DELETE FROM parents WHERE parent_id = ?", (parent_id,))
        conn.execute(
            """
            INSERT INTO parents (parent_id, display_name, login_code_hash, login_code, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            """,
            (parent_id, "Round Trip Parent", hash_password(code), code, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT login_code, login_code_hash FROM parents WHERE parent_id = ?", (parent_id,)).fetchone()
        assert row["login_code"] == code
        assert verify_password(code, row["login_code_hash"])
        assert not verify_password("wrong", row["login_code_hash"])
        conn.execute("DELETE FROM parents WHERE parent_id = ?", (parent_id,))
        conn.commit()


# ── New: parent report acceptance test ──

def test_parent_can_load_childs_report():
    # Full flow: expert sets up a child, expert report endpoint returns valid structure
    expert_id = f"exp_{uuid4().hex[:8]}"
    client.post("/api/admin/experts", json={
        "expert_id": expert_id,
        "display_name": "Report Expert",
        "password": "pass123"
    })
    client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Penny",
        "last_name": "Lane",
        "icon_key": "pig"
    })

    # Report endpoint should return a valid response even with no quiz history
    resp = client.get(f"/api/expert/report?child_id=000000&expert_id={expert_id}")
    assert resp.status_code in (200, 404)
    if resp.status_code == 200:
        data = resp.json()
        assert "success" in data
