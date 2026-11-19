#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>
#include <utility>
#include <vector>

namespace saaman {
class RecentDiagnostics {
public:
    using Clock = std::chrono::steady_clock;
    static constexpr std::size_t ByteLimit = 16 * 1024 * 1024;
    static constexpr std::size_t PageLimit = 1024 * 1024;
    static constexpr std::size_t FrameLimit = 1200;
    static constexpr auto Retention = std::chrono::minutes(30);

    struct Page {
        std::uint64_t after, through;
        bool complete, trimmed;
        std::vector<std::string> frames;
    };

    bool Add(std::string payload, Clock::time_point at = Clock::now()) {
        if (payload.size() > PageLimit) return false;
        Prune(at);
        while (!entries.empty() && (entries.size() >= FrameLimit || usedBytes + payload.size() > ByteLimit)) Pop();
        const auto size = payload.size();
        entries.push_back({nextId, at, std::move(payload)});
        ++nextId;
        usedBytes += size;
        return true;
    }

    Page Read(std::uint64_t after, std::uint64_t through, Clock::time_point at = Clock::now()) {
        Prune(at);
        const auto oldest = entries.empty() ? nextId : entries.front().id;
        if (through == 0 || through >= nextId) through = nextId - 1;
        Page page{after, through, true, after > 0 && after < through && after < oldest - 1, {}};
        std::size_t bytes = 0;
        for (const auto& entry : entries) {
            if (entry.id <= after) continue;
            if (entry.id > through) break;
            if (!page.frames.empty() && (bytes + entry.payload.size() > PageLimit || page.frames.size() == 48)) {
                page.complete = false;
                break;
            }
            page.frames.push_back(entry.payload);
            page.after = entry.id;
            bytes += entry.payload.size();
        }
        return page;
    }

private:
    struct Entry {
        std::uint64_t id;
        Clock::time_point at;
        std::string payload;
    };
    std::deque<Entry> entries;
    std::size_t usedBytes = 0;
    std::uint64_t nextId = 1;

    void Pop() {
        usedBytes -= entries.front().payload.size();
        entries.pop_front();
    }

    void Prune(Clock::time_point now) {
        while (!entries.empty() && now - entries.front().at >= Retention) Pop();
    }
};
}
