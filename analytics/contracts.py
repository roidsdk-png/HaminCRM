from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class LexiconRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stopwords: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(
        max_length=2000
    )


class GuideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    guide: dict[str, Any]
    confirmed: bool = False


class Source(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=200)
    slug: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=500)
    kind: str
    platform: str
    status: str = "active"


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=300)
    kind: Literal["message", "test", "match"]
    sourceId: str = Field(min_length=1, max_length=200)
    contactId: str | None = Field(default=None, max_length=300)
    conversationId: str | None = Field(default=None, max_length=300)
    role: Literal["user", "assistant", "system"] | None = None
    occurredAt: int
    text: str = Field(default="", max_length=1_000_000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    generation: str = Field(min_length=1, max_length=200)
    snapshotId: str = Field(min_length=1, max_length=200)
    sequence: int | None = None
    mode: Literal["full", "delta"] = "full"
    sources: list[Source] = Field(default_factory=list, max_length=10_000)
    records: list[Record] = Field(default_factory=list, max_length=2_000)
    deletedIds: list[str] = Field(default_factory=list, max_length=10_000)
    redactionNames: list[str] = Field(default_factory=list, max_length=10_000)
    complete: bool = False


class Filters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sourceIds: list[str] = Field(default_factory=list, max_length=100)
    kinds: list[Literal["message", "test", "match"]] = Field(default_factory=list)
    roles: list[Literal["user", "assistant", "system"]] = Field(
        default_factory=lambda: ["user"]
    )
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    contactId: str | None = None
    includeLinkedContacts: bool = False
    gender: str | None = None
    province: str | None = None
    ageFrom: int | None = Field(default=None, ge=0, le=120)
    ageTo: int | None = Field(default=None, ge=0, le=120)
    testKey: str | None = None
    includeExcluded: bool = False
    scoreKey: str | None = None
    scoreFrom: float | None = Field(default=None, allow_inf_nan=False)
    scoreTo: float | None = Field(default=None, allow_inf_nan=False)

    def as_dict(self):
        return self.model_dump(by_alias=True, exclude_none=True)


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["challenges", "emotions", "experiences", "research", "content"]
    query: str = Field(default="", max_length=20_000)
    filters: Filters = Field(default_factory=Filters)
    limit: int = Field(default=100, ge=1, le=1_000)
    sessionId: str | None = None
    categories: list[str] = Field(default_factory=list, max_length=100)
    evidenceIds: list[str] = Field(default_factory=list, max_length=500)
    format: Literal["article", "story", "instagram", "podcast", "ideas"] = "article"
    tone: str = Field(default="", max_length=1_000)
    length: str = Field(default="", max_length=1_000)
    requestKey: str | None = Field(default=None, max_length=200)


class SessionRequest(BaseModel):
    title: str = Field(default="تحقیق تازه", max_length=300)


class MessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20_000)
    filters: Filters | None = None
    limit: int = Field(default=100, ge=1, le=1_000)
    cursor: str | None = None


class ContentRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=20_000)
    format: Literal["article", "story", "instagram", "podcast", "ideas"] = "article"
    evidenceIds: list[str] = Field(default_factory=list, max_length=500)
    filters: Filters = Field(default_factory=Filters)
    tone: str = Field(default="", max_length=1_000)
    length: str = Field(default="", max_length=1_000)
    sessionId: str | None = None
