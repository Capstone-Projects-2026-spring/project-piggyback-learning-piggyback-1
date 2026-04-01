from app.services.question_generation_service import time_to_seconds
import pytest
from video_quiz_routes import normalize_text
from app.services.question_generation_service import build_segments_from_duration
#pytest runs any function starting with test_ 
# Testing assignment service functions
from app.services.sqlite_store import init_db
#Testing for children services
from uuid import uuid4
from app.services.children_service import (
    create_child,
    deactivate_child,
    generate_child_id,
    list_children,
    update_child,
    get_child,
)


from app.services.expert_auth_service import (
    add_video_assignment,
    remove_video_assignment,
    list_experts_for_video,
    can_expert_access_video,
    claim_video_for_expert,
    create_expert,
    delete_expert,
)
#make a value to test
def setup_module():
    init_db()
    try:
        create_expert("testexpert1", "Test Expert 1", "password123")
        create_expert("testexpert2", "Test Expert 2", "password123")
    except:
        pass 
#Testing time_to_seconds
def test_time_to_seconds_mmss():
    assert time_to_seconds("1:30") == 90

def test_time_to_seconds_hhmmss():
    assert time_to_seconds("1:00:00") == 3600

def test_time_to_seconds_bad_input():
    assert time_to_seconds("bad") == 0

def test_time_to_seconds_none():
    with pytest.raises(AttributeError):
            time_to_seconds(None) == 0

def test_time_to_seconds_seconds_only():
    assert time_to_seconds("45") == 45

def test_time_to_seconds_hhmmss_full():
    assert time_to_seconds("2:30:15") == 9015


#Testing for normalize_text
def test_normalize_text_removes_stopwords():
     assert normalize_text("the big dog") == "big dog"
    
def test_normalize_text_maps_synonyms():
    assert normalize_text("scared") == "afraid"

def test_normalize_text_empty():
    assert normalize_text("") == ""

#Testing for build_segment_from_duration
def test_build_segments_standard():
    assert build_segments_from_duration(180, 60) == [(0, 59), (60, 119), (120, 179), (180, 180)]

def test_build_segments_shorter_last():
    assert build_segments_from_duration(90, 60) == [(0, 59), (60, 90)]

def test_build_segments_single():
    assert build_segments_from_duration(60, 60) == [(0, 59), (60, 60)]

#Testing services
def test_add_assignment():
    add_video_assignment("vid_test", "testexpert1")
    assert can_expert_access_video("testexpert1", "vid_test") == True

def test_two_experts_same_video():
    add_video_assignment("vid_test", "testexpert2")
    experts = list_experts_for_video("vid_test")
    assert len(experts) == 2


def test_remove_assignment():
    remove_video_assignment("vid_test", "testexpert1")
    assert can_expert_access_video("testexpert1", "vid_test") == False

def test_claim_is_idempotent():
    claim_video_for_expert("testexpert2", "vid_test")
    claim_video_for_expert("testexpert2", "vid_test")  # twice, no error
    assert can_expert_access_video("testexpert2", "vid_test") == True
    
    
#Testing for childrens service

def _new_expert():
    expert_id = f"exp_{uuid4().hex[:10]}"
    return create_expert(expert_id, f"Expert {expert_id[-4:]}", "password123")

def test_generate_child_id_is_6_digit():
    child_id = generate_child_id()
    assert len(child_id) ==6
    assert child_id.isdigit()
    
def test_create_and_list_child():
    expert = _new_expert()
    child = create_child(expert["expert_id"], "Mia", "Lin", "fox")
    children = list_children(expert_id=expert["expert_id"])
    assert any(c["child_id"] == child["child_id"] for c in children)

def test_same_name_different_experts_allowed():
    expert_a = _new_expert()
    expert_b = _new_expert()
    child_a = create_child(expert_a["expert_id"], "Noah", "Kim", "bear")
    child_b = create_child(expert_b["expert_id"], "Noah", "Kim", "bear")
    assert child_a["child_id"] != child_b["child_id"]


def test_duplicate_name_same_expert_now_allowed():
    # unique name index was dropped -- same first+last under same expert is now allowed
    expert = _new_expert()
    child_a = create_child(expert["expert_id"], "Ava", "Stone", "cat")
    child_b = create_child(expert["expert_id"], "Ava", "Stone", "fox")
    assert child_a["child_id"] != child_b["child_id"]
    children = list_children(expert_id=expert["expert_id"])
    assert len([c for c in children if c["first_name"] == "Ava"]) == 2

def test_invalid_icon_rejected():
    expert = _new_expert()
    with pytest.raises(ValueError, match="icon_key is invalid"):
        create_child(expert["expert_id"], "Leo", "Park", "dragon")
        
def test_update_and_deactivate_child():
    expert = _new_expert()
    child = create_child(expert["expert_id"], "Ivy", "Cho", "owl")

    updated = update_child(child["child_id"], first_name="Zoey", icon_key="penguin")
    assert updated["first_name"] == "Zoey"
    assert updated["icon_key"] == "penguin"

    deactivate_child(child["child_id"])
    active_children = list_children(expert_id=expert["expert_id"])
    all_children = list_children(expert_id=expert["expert_id"], include_inactive=True)

    assert not any(c["child_id"] == child["child_id"] for c in active_children)
    assert any(c["child_id"] == child["child_id"] and c["is_active"] is False for c in all_children)
    
    
#more test on childrens condition


#new test for Icon behaviors

# Testing new icon keys added in companion update
from app.services.children_service import ALLOWED_CHILD_ICON_KEYS, normalize_child_id, normalize_name, normalize_icon_key

def test_new_icon_keys_are_valid():
    new_icons = ["simba", "nemo", "walle", "moana", "elsa", "spiderman", "mickey",
                 "pooh", "chase", "spongebob", "turtle", "bluey", "hellokitty",
                 "mlp", "peppa", "mario", "dino"]
    for icon in new_icons:
        assert icon in ALLOWED_CHILD_ICON_KEYS, f"{icon} should be allowed"

def test_bad_icon_still_rejected():
    assert "dragon" not in ALLOWED_CHILD_ICON_KEYS
    assert "unicorn" not in ALLOWED_CHILD_ICON_KEYS


# Testing normalize helpers
def test_normalize_child_id_strips_whitespace():
    assert normalize_child_id("  123456  ") == "123456"

def test_normalize_child_id_empty():
    assert normalize_child_id("") == ""
    assert normalize_child_id(None) == ""

def test_normalize_name_collapses_spaces():
    assert normalize_name("  John   Doe  ") == "John Doe"

def test_normalize_name_empty():
    assert normalize_name("") == ""

def test_normalize_icon_key_lowercases():
    assert normalize_icon_key("PIG") == "pig"
    assert normalize_icon_key(" Fox ") == "fox"


# Testing delete_child
from app.services.children_service import delete_child

def test_delete_child_removes_record():
    expert = _new_expert()
    suffix = uuid4().hex[:6]
    child = create_child(expert["expert_id"], f"Del{suffix}", "Test", "cat")
    child_id = child["child_id"]

    result = delete_child(child_id)
    assert result is True
    assert get_child(child_id, include_inactive=True) is None

def test_delete_child_nonexistent_returns_false():
    assert delete_child("999999") is False


# Testing hash_password and verify_password
from app.services.expert_auth_service import hash_password, verify_password

def test_hash_password_is_not_plaintext():
    hashed = hash_password("mysecret")
    assert hashed != "mysecret"

def test_verify_password_correct():
    hashed = hash_password("mysecret")
    assert verify_password("mysecret", hashed) is True

def test_verify_password_wrong():
    hashed = hash_password("mysecret")
    assert verify_password("wrongpassword", hashed) is False
