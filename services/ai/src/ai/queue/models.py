from typing import Literal, TypedDict
from uuid import UUID


class ClaimResult(TypedDict):
    status: Literal["claimed", "completed", "busy"]
    key: str
    token: UUID | None
