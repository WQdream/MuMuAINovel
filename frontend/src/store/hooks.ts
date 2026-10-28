/**
 * Store Hooks - 提供数据获取和自动同步功能
 * 这些 hooks 封装了数据获取逻辑，并自动更新 store
 */

import { useCallback } from 'react';
import { message } from 'antd';
import { useStore } from './index';
import { projectApi, outlineApi, characterApi, chapterApi } from '../services/api';
import type {
  PaginationResponse,
  Outline,
  Character,
  Chapter,
  Project,
  ProjectCreate,
  ProjectUpdate,
  OutlineCreate,
  OutlineUpdate,
  ChapterCreate,
  ChapterUpdate,
  GenerateOutlineRequest,
  GenerateCharacterRequest
} from '../types';

/**
 * 项目数据同步 Hook
 */
export function useProjectSync() {
  const { setProjects, setLoading, addProject, updateProject, removeProject } = useStore();

  // 刷新项目列表
  const refreshProjects = useCallback(async () => {
    try {
      setLoading(true);
      const data = await projectApi.getProjects();
      const projects = Array.isArray(data) ? data : (data as PaginationResponse<Project>).items || [];
      setProjects(projects);
      return projects;
    } catch (error) {
      console.error('刷新项目列表失败:', error);
      message.error('刷新项目列表失败');
      return [];
    } finally {
      setLoading(false);
    }
  }, [setProjects, setLoading]);

  // 创建项目（带同步）
  const createProject = useCallback(async (data: ProjectCreate) => {
    try {
      const created = await projectApi.createProject(data);
      addProject(created);
      return created;
    } catch (error) {
      console.error('创建项目失败:', error);
      throw error;
    }
  }, [addProject]);

  // 更新项目（带同步）
  const updateProjectSync = useCallback(async (id: string, data: ProjectUpdate) => {
    try {
      const updated = await projectApi.updateProject(id, data);
      updateProject(id, updated);
      return updated;
    } catch (error) {
      console.error('更新项目失败:', error);
      throw error;
    }
  }, [updateProject]);

  // 删除项目（带同步）
  const deleteProject = useCallback(async (id: string) => {
    try {
      await projectApi.deleteProject(id);
      removeProject(id);
    } catch (error) {
      console.error('删除项目失败:', error);
      throw error;
    }
  }, [removeProject]);

  return {
    refreshProjects,
    createProject,
    updateProject: updateProjectSync,
    deleteProject,
  };
}

/**
 * 角色数据同步 Hook
 */
export function useCharacterSync() {
  const { currentProject, setCharacters, addCharacter, removeCharacter } = useStore();

  // 刷新角色列表
  const refreshCharacters = useCallback(async (projectId?: string) => {
    const id = projectId || currentProject?.id;
    if (!id) return [];

    try {
      const data = await characterApi.getCharacters(id);
      const characters = Array.isArray(data) ? data : (data as PaginationResponse<Character>).items || [];
      setCharacters(characters);
      return characters;
    } catch (error) {
      console.error('刷新角色列表失败:', error);
      message.error('刷新角色列表失败');
      return [];
    }
  }, [currentProject?.id, setCharacters]);

  // 删除角色（带同步）
  const deleteCharacter = useCallback(async (id: string) => {
    try {
      await characterApi.deleteCharacter(id);
      removeCharacter(id);
    } catch (error) {
      console.error('删除角色失败:', error);
      throw error;
    }
  }, [removeCharacter]);

  // AI生成角色（带同步）
  const generateCharacter = useCallback(async (data: GenerateCharacterRequest) => {
    try {
      const generated = await characterApi.generateCharacter(data);
      addCharacter(generated);
      return generated;
    } catch (error) {
      console.error('AI生成角色失败:', error);
      throw error;
    }
  }, [addCharacter]);

  return {
    refreshCharacters,
    deleteCharacter,
    generateCharacter,
  };
}

/**
 * 大纲数据同步 Hook
 */
export function useOutlineSync() {
  const { currentProject, setOutlines, addOutline, updateOutline, removeOutline } = useStore();

  // 刷新大纲列表
  const refreshOutlines = useCallback(async (projectId?: string) => {
    const id = projectId || currentProject?.id;
    if (!id) return [];

    try {
      const data = await outlineApi.getOutlines(id);
      const outlines = Array.isArray(data) ? data : (data as PaginationResponse<Outline>).items || [];
      setOutlines(outlines);
      return outlines;
    } catch (error) {
      console.error('刷新大纲列表失败:', error);
      message.error('刷新大纲列表失败');
      return [];
    }
  }, [currentProject?.id, setOutlines]); // 添加 currentProject?.id 到依赖数组

  // 创建大纲（带同步）
  const createOutline = useCallback(async (data: OutlineCreate) => {
    try {
      const created = await outlineApi.createOutline(data);
      addOutline(created);
      return created;
    } catch (error) {
      console.error('创建大纲失败:', error);
      throw error;
    }
  }, [addOutline]);

  // 更新大纲（带同步）
  const updateOutlineSync = useCallback(async (id: string, data: OutlineUpdate) => {
    try {
      const updated = await outlineApi.updateOutline(id, data);
      updateOutline(id, updated);
      return updated;
    } catch (error) {
      console.error('更新大纲失败:', error);
      throw error;
    }
  }, [updateOutline]);

  // 删除大纲（带同步）
  const deleteOutline = useCallback(async (id: string) => {
    try {
      await outlineApi.deleteOutline(id);
      removeOutline(id);
    } catch (error) {
      console.error('删除大纲失败:', error);
      throw error;
    }
  }, [removeOutline]);

  // AI生成大纲（带同步）
  const generateOutlines = useCallback(async (data: GenerateOutlineRequest) => {
    try {
      const result = await outlineApi.generateOutline(data);
      const outlines = Array.isArray(result) ? result : (result as PaginationResponse<Outline>).items || [];
      outlines.forEach((outline: Outline) => addOutline(outline));
      return outlines;
    } catch (error) {
      console.error('AI生成大纲失败:', error);
      throw error;
    }
  }, [addOutline]);

  return {
    refreshOutlines,
    createOutline,
    updateOutline: updateOutlineSync,
    deleteOutline,
    generateOutlines,
  };
}

/**
 * 章节数据同步 Hook
 */
export function useChapterSync() {
  const { currentProject, setChapters, addChapter, updateChapter, removeChapter } = useStore();

  // 刷新章节列表
  const refreshChapters = useCallback(async (projectId?: string) => {
    const id = projectId || currentProject?.id;
    if (!id) return [];

    try {
      const data = await chapterApi.getChapters(id);
      const chapters = Array.isArray(data) ? data : (data as PaginationResponse<Chapter>).items || [];
      setChapters(chapters);
      return chapters;
    } catch (error) {
      console.error('刷新章节列表失败:', error);
      message.error('刷新章节列表失败');
      return [];
    }
  }, [currentProject?.id, setChapters]); // 添加 currentProject?.id 到依赖数组

  // 创建章节（带同步）
  const createChapter = useCallback(async (data: ChapterCreate) => {
    try {
      const created = await chapterApi.createChapter(data);
      addChapter(created);
      return created;
    } catch (error) {
      console.error('创建章节失败:', error);
      throw error;
    }
  }, [addChapter]);

  // 更新章节（带同步）
  const updateChapterSync = useCallback(async (id: string, data: ChapterUpdate) => {
    try {
      const updated = await chapterApi.updateChapter(id, data);
      updateChapter(id, updated);
      return updated;
    } catch (error) {
      console.error('更新章节失败:', error);
      throw error;
    }
  }, [updateChapter]);

  // 删除章节（带同步）
  const deleteChapter = useCallback(async (id: string) => {
    try {
      await chapterApi.deleteChapter(id);
      removeChapter(id);
    } catch (error) {
      console.error('删除章节失败:', error);
      throw error;
    }
  }, [removeChapter]);

  // AI流式生成章节内容（带同步）
  const generateChapterContentStream = useCallback(async (
    chapterId: string,
    onProgress?: (content: string) => void,
    styleId?: number,
    targetWordCount?: number,
    onProgressUpdate?: (message: string, progress: number) => void,
    model?: string,
    narrativePerspective?: string,
    skillKey?: string,
    autoPolish?: boolean
  ) => {
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), 180000);
    };

    try {
      resetIdleTimer();
      // 使用fetch处理流式响应
      const response = await fetch(`/api/chapters/${chapterId}/generate-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          style_id: styleId,
          target_word_count: targetWordCount,
          model: model,
          narrative_perspective: narrativePerspective,
          skill_key: skillKey,
          auto_polish: Boolean(autoPolish),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        let detail = errorBody;
        try {
          const parsed = JSON.parse(errorBody);
          detail = parsed.detail || parsed.message || errorBody;
        } catch {
          // 保留原始响应文本
        }
        throw new Error(detail || `请求失败（${response.status}）`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法获取响应流');
      }

      let buffer = '';
      let fullContent = '';
      let analysisTaskId: string | undefined;
      let doneReceived = false;

      const handleEvent = async (rawEvent: string) => {
        if (rawEvent.trim() === '' || rawEvent.trimStart().startsWith(':')) {
          return;
        }

        let eventName = '';
        const dataLines: string[] = [];
        for (const line of rawEvent.split(/\r?\n/)) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }
        if (dataLines.length === 0) return;

        let message: Record<string, unknown>;
        try {
          message = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;
        } catch (parseError) {
          throw new Error(`AI响应格式异常：${parseError instanceof Error ? parseError.message : '无法解析'}`);
        }
        if (!message.type && eventName) {
          message.type = eventName;
        }
        const messageType = typeof message.type === 'string' ? message.type : '';
        const messageContent = typeof message.content === 'string' ? message.content : '';
        const messageError = typeof message.error === 'string' ? message.error : '生成失败';

        if (messageType === 'start') {
          onProgressUpdate?.(typeof message.message === 'string' ? message.message : '开始生成...', 0);
        } else if (messageType === 'progress') {
          onProgressUpdate?.(
            typeof message.message === 'string' ? message.message : '生成中...',
            typeof message.progress === 'number' ? message.progress : 0,
          );
        } else if ((messageType === 'content' || messageType === 'chunk') && messageContent) {
          fullContent += messageContent;
          onProgress?.(fullContent);
        } else if (messageType === 'error') {
          throw new Error(messageError);
        } else if (messageType === 'result') {
          const resultData = message.data as { analysis_task_id?: string } | undefined;
          if (resultData?.analysis_task_id) {
            analysisTaskId = resultData.analysis_task_id;
          }
          onProgressUpdate?.('生成完成', 100);
        } else if (messageType === 'done') {
          doneReceived = true;
          await refreshChapters();
        } else if (messageType === 'analysis_started') {
          if (typeof message.task_id === 'string') analysisTaskId = message.task_id;
          onProgressUpdate?.('章节分析已开始...', 100);
        } else if (messageType === 'analysis_queued') {
          if (typeof message.task_id === 'string') analysisTaskId = message.task_id;
        } else if (messageType === 'auto_polish') {
          const applied = message.applied === true;
          const skipped = typeof message.skipped === 'string' ? message.skipped : '';
          if (applied) {
            const before = typeof message.score_before === 'number' ? message.score_before : -1;
            const after = typeof message.score_after === 'number' ? message.score_after : -1;
            const punctuation = typeof message.punctuation_fixed === 'number' ? message.punctuation_fixed : 0;
            onProgressUpdate?.(
              `自动去味完成：干净度 ${before} → ${after}${punctuation ? `，整理标点 ${punctuation} 处` : ''}`,
              95,
            );
          } else {
            onProgressUpdate?.(`自动去味已跳过：${skipped || '模型未交付完整正文'}`, 95);
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          buffer += decoder.decode();
          if (buffer.trim()) {
            await handleEvent(buffer);
            buffer = '';
          }
          break;
        }

        resetIdleTimer();
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const event of events) {
          await handleEvent(event);
        }
      }

      if (!doneReceived) {
        throw new Error(
          fullContent
            ? `AI生成意外中断（已生成 ${fullContent.length} 字，未保存）。请检查模型服务后重试`
            : 'AI生成意外中断，未收到完成信号。请检查模型服务后重试',
        );
      }

      return {
        content: fullContent,
        analysis_task_id: analysisTaskId
      };
    } catch (error) {
      console.error('AI流式生成章节内容失败:', error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('AI生成超时，请检查模型服务是否正常响应');
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
  }, [refreshChapters]);

  return {
    refreshChapters,
    createChapter,
    updateChapter: updateChapterSync,
    deleteChapter,
    generateChapterContentStream,
  };
}
