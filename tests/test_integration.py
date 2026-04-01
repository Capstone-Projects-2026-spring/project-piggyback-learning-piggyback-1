from fastapi.testclient import TestClient
from main import app
from uuid import uuid4
from app.services.sqlite_store import init_db

#warps the app into the fkae browser , client can send GET ,POST etc request to it.
client = TestClient(app)

def setup_module():
    init_db()

def test_check_answer_correct():
    #POST request to like our frontend.
    response = client.post("/api/check_answer", json= {
        "expected": "dog",
        "user" : "dog",
        "question": "what animal is it" 
    })
    #did the server respond well? 
    assert response.status_code == 200
    assert response.json()["status"]== "correct"

    #Get config which returns app config
    #checking if the route exists, if its deleted or waht not.
    
def test_get_config():
    #GET request to that endpoint
    response = client.get("/api/config")
    assert response.status_code == 200
    #threshold comfirms that the forntend will get data it needs to work.
    assert "thresholds" in response.json()


def test_learner_can_fetch_video_list():
    # Use Case 2: Learner sees list of available quizzes
    response = client.get("/api/videos-list")
    assert response.status_code == 200

def test_learner_can_fetch_questions_for_video():
    # Use Case 2: System displays quiz questions for selected video
    response = client.get("/api/final-questions/test-video-id")
    assert response.status_code == 200
    

def test_admin_can_unlink_child_endpoint():
    expert_id = f"exp_{uuid4().hex[:8]}"
    client.post("/api/admin/experts", json={
        "expert_id": expert_id,
        "display_name": "Tmp Expert",
        "password": "password123"
    })
    
    create_child_resp = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Mia",
        "last_name": f"Lin{uuid4().hex[:4]}",
        "icon_key": "fox",
    })
    child_id = create_child_resp.json()["child"]["child_id"]

    unlink_resp = client.post(f"/api/admin/children/{child_id}/unlink")

    assert unlink_resp.status_code == 200
    assert unlink_resp.json()["success"] is True
    assert unlink_resp.json()["child"]["expert_id"] is None

def test_admin_can_relink_child_with_put():
    expert_a = f"exp_{uuid4().hex[:8]}"
    expert_b = f"exp_{uuid4().hex[:8]}"

    client.post("/api/admin/experts", json={
        "expert_id": expert_a, "display_name": "Expert A", "password": "password123"
    })
    client.post("/api/admin/experts", json={
        "expert_id": expert_b, "display_name": "Expert B", "password": "password123"
    })

    create_child_resp = client.post("/api/admin/children", json={
        "expert_id": expert_a,
        "first_name": "Noah",
        "last_name": f"Kim{uuid4().hex[:4]}",
        "icon_key": "bear",
    })
    child_id = create_child_resp.json()["child"]["child_id"]

    client.post(f"/api/admin/children/{child_id}/unlink")
    relink_resp = client.put(f"/api/admin/children/{child_id}", json={"expert_id": expert_b})

    assert relink_resp.status_code == 200
    assert relink_resp.json()["success"] is True
    assert relink_resp.json()["child"]["expert_id"] == expert_b
    
def test_learner_child_videos_empty_when_unlinked():
    expert_id = f"exp_{uuid4().hex[:8]}"
    client.post("/api/admin/experts", json={
        "expert_id": expert_id, "display_name": "Tmp", "password": "password123"
    })

    create_child_resp = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Ivy",
        "last_name": f"Cho{uuid4().hex[:4]}",
        "icon_key": "owl",
    })
    child_id = create_child_resp.json()["child"]["child_id"]

    client.post(f"/api/admin/children/{child_id}/unlink")
    learner_resp = client.get(f"/api/learners/children/{child_id}/videos")

    assert learner_resp.status_code == 200
    body = learner_resp.json()
    assert body["success"] is True
    assert body["count"] == 0
    assert "not linked" in body.get("message", "").lower()


def test_delete_expert_endpoint_unlinks_child_not_fail():
    expert_id = f"exp_{uuid4().hex[:8]}"
    client.post("/api/admin/experts", json={
        "expert_id": expert_id, "display_name": "Tmp", "password": "password123"
    })

    create_child_resp = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Leo",
        "last_name": f"Park{uuid4().hex[:4]}",
        "icon_key": "cat",
    })
    child_id = create_child_resp.json()["child"]["child_id"]

    delete_resp = client.delete(f"/api/admin/experts/{expert_id}")
    assert delete_resp.status_code == 200

    children_resp = client.get("/api/admin/children?include_inactive=true")
    rows = children_resp.json()["children"]
    child = next(c for c in rows if c["child_id"] == child_id)

    assert child["expert_id"] is None


#new test for icon expe
def _make_expert():
    expert_id = f"exp_{uuid4().hex[:8]}"
    client.post("/api/admin/experts", json={
        "expert_id": expert_id,
        "display_name": "Test Expert",
        "password": "pass123"
    })
    return expert_id


# New companion icon keys are accepted by the API
def test_new_icon_keys_accepted_by_api():
    expert_id = _make_expert()
    for icon in ["simba", "nemo", "mario", "bluey", "peppa"]:
        resp = client.post("/api/admin/children", json={
            "expert_id": expert_id,
            "first_name": f"Kid{icon}",
            "last_name": "Test",
            "icon_key": icon,
        })
        assert resp.status_code == 200, f"{icon} should be accepted, got {resp.json()}"
        assert resp.json()["child"]["icon_key"] == icon


# Invalid icon is rejected by the API with a 422/400
def test_invalid_icon_rejected_by_api():
    expert_id = _make_expert()
    resp = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Bad",
        "last_name": "Icon",
        "icon_key": "dragon",
    })
    assert resp.status_code != 200


# Duplicate name under same expert is now allowed via the API
def test_duplicate_name_same_expert_allowed_via_api():
    expert_id = _make_expert()
    resp1 = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Ava",
        "last_name": "Stone",
        "icon_key": "cat",
    })
    resp2 = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Ava",
        "last_name": "Stone",
        "icon_key": "fox",
    })
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json()["child"]["child_id"] != resp2.json()["child"]["child_id"]


# Delete child endpoint removes the child
def test_delete_child_endpoint():
    expert_id = _make_expert()
    create_resp = client.post("/api/admin/children", json={
        "expert_id": expert_id,
        "first_name": "Temp",
        "last_name": "Child",
        "icon_key": "bear",
    })
    child_id = create_resp.json()["child"]["child_id"]

    delete_resp = client.delete(f"/api/admin/children/{child_id}")
    assert delete_resp.status_code == 200
    assert delete_resp.json()["success"] is True

    # Child should no longer appear even with include_inactive
    list_resp = client.get(f"/api/admin/children?include_inactive=true")
    ids = [c["child_id"] for c in list_resp.json()["children"]]
    assert child_id not in ids


# Deleting a nonexistent child returns 404
def test_delete_child_nonexistent_returns_404():
    resp = client.delete("/api/admin/children/999999")
    assert resp.status_code == 404