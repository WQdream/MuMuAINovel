"""产品版本记录 API。

独立部署不再读取上游仓库的提交历史，接口只返回当前产品维护的版本记录。
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app.config import settings

router = APIRouter()


def require_login(request: Request):
    if not hasattr(request.state, "user") or not request.state.user:
        raise HTTPException(status_code=401, detail="需要登录")
    return request.state.user


class ChangelogAuthor(BaseModel):
    name: str
    email: str
    date: str


class ChangelogCommitInfo(BaseModel):
    author: ChangelogAuthor
    message: str


class ChangelogCommit(BaseModel):
    sha: str
    commit: ChangelogCommitInfo
    html_url: str
    author: None = None


class ChangelogResponse(BaseModel):
    commits: list[ChangelogCommit]
    cached: bool
    cache_time: str | None = None


def _version_commits() -> list[ChangelogCommit]:
    now = datetime.now().astimezone().isoformat()
    author = ChangelogAuthor(name=settings.app_name, email="", date=now)
    entries = [
        ("editorial-shell", "style(界面): 作品库、项目工作台与登录页升级为现代编辑部视觉"),
        ("chapter-polish", "feat(写作): 精修台提供改前改后对照、分析与原文视图"),
        ("cover-failure", "fix(封面): 封面生成失败提示支持重试、检查配置与手动关闭"),
    ]
    return [
        ChangelogCommit(
            sha=f"local-{key}",
            commit=ChangelogCommitInfo(author=author, message=message),
            html_url="",
        )
        for key, message in entries
    ]


@router.get("/changelog", response_model=ChangelogResponse)
async def get_changelog(
    page: int = Query(1, ge=1, description="页码"),
    per_page: int = Query(30, ge=1, le=100, description="每页数量"),
):
    commits = _version_commits()
    start = (page - 1) * per_page
    return ChangelogResponse(commits=commits[start:start + per_page], cached=False)


@router.post("/changelog/refresh")
async def refresh_changelog(user=Depends(require_login)):
    del user
    return ChangelogResponse(commits=_version_commits(), cached=False)
