export interface BriaAsyncResponse {
  request_id: string;
  status_url: string;
}

export interface BriaStatusResponse {
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  request_id: string;
  result?: {
    image_url: string;
  };
  error?: string;
}

export interface RemoveBackgroundResult {
  request_id: string;
  image_url: string;
}
