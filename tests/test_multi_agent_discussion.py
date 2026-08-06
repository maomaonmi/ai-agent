import unittest

from main import (
    ChatRequest,
    CustomAgentConfig,
    get_discussion_limits,
    route_after_discussion_round,
    select_discussion_partner,
)
from pydantic import ValidationError


def agent(agent_id: str, name: str) -> CustomAgentConfig:
    return CustomAgentConfig(
        id=agent_id,
        name=name,
        description=f"{name}的功能描述",
        system_prompt=f"你是{name}，请准确回答问题。",
    )


class DiscussionLengthTests(unittest.TestCase):
    def test_length_presets_have_strictly_increasing_token_budgets(self):
        brief = get_discussion_limits("brief")
        balanced = get_discussion_limits("balanced")
        detailed = get_discussion_limits("detailed")

        self.assertLess(brief["turn_tokens"], balanced["turn_tokens"])
        self.assertLess(balanced["turn_tokens"], detailed["turn_tokens"])
        self.assertLess(brief["final_tokens"], balanced["final_tokens"])
        self.assertLess(balanced["final_tokens"], detailed["final_tokens"])

    def test_request_rejects_unknown_length_and_too_many_custom_agents(self):
        with self.assertRaises(ValidationError):
            ChatRequest(message="讨论", mode="agent", discussion_length="unlimited")
        with self.assertRaises(ValidationError):
            ChatRequest(
                message="讨论",
                mode="agent",
                discussion_agent_ids=[f"agent-{index}" for index in range(6)],
            )

    def test_request_defaults_to_two_rounds_and_rejects_out_of_range_values(self):
        self.assertEqual(ChatRequest(message="discussion").discussion_rounds, 2)
        with self.assertRaises(ValidationError):
            ChatRequest(message="discussion", discussion_rounds=0)
        with self.assertRaises(ValidationError):
            ChatRequest(message="discussion", discussion_rounds=6)


class DiscussionParticipantTests(unittest.TestCase):
    def test_selected_custom_agent_is_preferred_as_second_speaker(self):
        agents = {
            "physics": agent("physics", "物理学家"),
            "friendly-critic": agent("friendly-critic", "脑洞观察员"),
        }

        partner = select_discussion_partner(
            agents,
            target_agent_id="physics",
            preferred_agent_ids=["friendly-critic"],
        )

        self.assertEqual(partner.id, "friendly-critic")

    def test_target_is_never_selected_as_its_own_partner(self):
        agents = {"only-agent": agent("only-agent", "唯一专家")}

        partner = select_discussion_partner(
            agents,
            target_agent_id="only-agent",
            preferred_agent_ids=["only-agent"],
        )

        self.assertIsNone(partner)

    def test_selected_custom_agents_rotate_across_rounds(self):
        agents = {
            "target": agent("target", "Target"),
            "custom-a": agent("custom-a", "Custom A"),
            "custom-b": agent("custom-b", "Custom B"),
        }

        first = select_discussion_partner(
            agents,
            target_agent_id="target",
            preferred_agent_ids=["custom-a", "custom-b"],
            round_index=0,
        )
        second = select_discussion_partner(
            agents,
            target_agent_id="target",
            preferred_agent_ids=["custom-a", "custom-b"],
            round_index=1,
        )

        self.assertEqual(first.id, "custom-a")
        self.assertEqual(second.id, "custom-b")

    def test_discussion_routes_until_configured_rounds_are_complete(self):
        self.assertEqual(
            route_after_discussion_round(
                {"current_discussion_round": 1, "discussion_rounds": 3}
            ),
            "discussion",
        )
        self.assertEqual(
            route_after_discussion_round(
                {"current_discussion_round": 3, "discussion_rounds": 3}
            ),
            "synthesis",
        )


if __name__ == "__main__":
    unittest.main()
