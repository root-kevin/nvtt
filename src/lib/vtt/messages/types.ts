export type MessageCategory = "toast" | "roll" | "warning" | "gm" | "measure";

export interface VTTMessage {
    id: string;
    category: MessageCategory;
    text: string;
    timestamp: number;
    mapId?: string;
    payload?: any;
}
