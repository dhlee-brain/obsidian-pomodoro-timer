import PomodoroTimerPlugin from 'main'
import { type CachedMetadata, type TFile, type App } from 'obsidian'
import { extractTaskComponents } from 'utils'
import { writable, derived, type Readable, type Writable } from 'svelte/store'

import type { TaskFormat } from 'Settings'
import type { Unsubscriber } from 'svelte/motion'
import { DESERIALIZERS } from 'serializer'

export type TaskItem = {
    path: string
    text: string
    fileName: string
    name: string
    status: string
    blockLink: string
    checked: boolean
    done: string
    due: string
    created: string
    cancelled: string
    scheduled: string
    start: string
    description: string
    priority: string
    recurrence: string
    expected: number
    actual: number
    tags: string[]
    line: number
}

export type TaskStore = {
    list: TaskItem[]
}

export function resolveTasks(
    format: TaskFormat,
    file: TFile,
    content: string,
    metadata: CachedMetadata | null,
): TaskItem[] {
    if (!content || !metadata) {
        return []
    }

    let cache: Record<number, TaskItem> = {}
    const lines = content.split('\n')
    for (let rawElement of metadata.listItems || []) {
        if (rawElement.task) {
            let lineNr = rawElement.position.start.line
            let line = lines[lineNr]

            const components = extractTaskComponents(line)
            if (!components) {
                continue
            }
            let detail = DESERIALIZERS[format].deserialize(components.body)

            let [actual, expected] = detail.pomodoros.split('/')

            const dateformat = 'YYYY-MM-DD'
            let item: TaskItem = {
                text: line,
                path: file.path,
                fileName: file.name,
                name: detail.description,
                status: components.status,
                blockLink: components.blockLink,
                checked: rawElement.task != '' && rawElement.task != ' ',
                description: detail.description,
                done: detail.doneDate?.format(dateformat) ?? '',
                due: detail.dueDate?.format(dateformat) ?? '',
                created: detail.createdDate?.format(dateformat) ?? '',
                cancelled: detail.cancelledDate?.format(dateformat) ?? '',
                scheduled: detail.scheduledDate?.format(dateformat) ?? '',
                start: detail.startDate?.format(dateformat) ?? '',
                priority: detail.priority,
                recurrence: detail.recurrenceRule,
                expected: expected ? parseInt(expected) : 0,
                actual: actual === '' ? 0 : parseInt(actual),
                tags: detail.tags,
                line: lineNr,
            }

            cache[lineNr] = item
        }
    }

    return Object.values(cache)
}

export default class Tasks implements Readable<TaskStore> {
    public static getDeserializer(format: TaskFormat) {
        return DESERIALIZERS[format]
    }

    private plugin: PomodoroTimerPlugin

    private store: Writable<TaskStore>

    private state: TaskStore = {
        list: [],
    }

    public subscribe

    private unsubscribers: Unsubscriber[] = []

    constructor(plugin: PomodoroTimerPlugin) {
        this.plugin = plugin

        this.store = writable(this.state)

        this.subscribe = this.store.subscribe

        this.unsubscribers.push(
            this.store.subscribe((state) => {
                this.state = state
            }),
        )

        this.unsubscribers.push(
            derived(this.plugin.tracker!, ($tracker) => {
                return $tracker.file?.path
            }).subscribe(() => {
                // 리팩토링 하면 좋을듯.
                let file = this.plugin.tracker?.file
                if (file) {
                    this.loadFileTasks(file)
                } else {
                    this.clearTasks()
                }
            }),
        )

        this.plugin.registerEvent(
            plugin.app.metadataCache.on(
                'changed',
                (file: TFile, content: string, cache: CachedMetadata) => {
                    if (
                        file.extension === 'md' &&
                        file == this.plugin.tracker!.file
                    ) {
                        let tasks = resolveTasks(
                            this.plugin.getSettings().taskFormat,
                            file,
                            content,
                            cache,
                        )
                        this.store.update((state) => {
                            state.list = tasks
                            return state
                        })

                        // sync active task
                        if (this.plugin.tracker?.task?.blockLink) {
                            let task = tasks.find(
                                (item) =>
                                    item.blockLink &&
                                    item.blockLink ===
                                        this.plugin.tracker?.task?.blockLink,
                            )
                            if (task) {
                                this.plugin.tracker.sync(task)
                            }
                        }
                    }
                },
            ),
        )
    }

    public loadFileTasks(file: TFile) {
        if (file.extension == 'md') {
            this.plugin.app.vault.cachedRead(file).then((c) => {
                let tasks = resolveTasks(
                    this.plugin.getSettings().taskFormat,
                    file,
                    c,
                    this.plugin.app.metadataCache.getFileCache(file),
                )
                this.store.update(() => ({
                    list: tasks,
                }))
            })
        } else {
            this.store.update(() => ({
                file,
                list: [],
            }))
        }
    }

    public clearTasks() {
        this.store.update(() => ({
            list: [],
        }))
    }

    public destroy() {
        for (let unsub of this.unsubscribers) {
            unsub()
        }
    }
}
