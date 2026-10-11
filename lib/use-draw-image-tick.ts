import { useEffect, useState } from "react";
import { DRAW_IMAGE_READY_EVENT } from "@/lib/draw-renderer";

/** 그림 속 사진이 풀릴 때마다 바뀌는 수. 그림을 그리는 효과의 의존값에 넣으면 사진이 풀린 뒤 다시 그린다. */
export function useDrawImageTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    window.addEventListener(DRAW_IMAGE_READY_EVENT, bump);
    return () => window.removeEventListener(DRAW_IMAGE_READY_EVENT, bump);
  }, []);
  return tick;
}
