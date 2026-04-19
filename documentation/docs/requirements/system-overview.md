---
sidebar_position: 1
---

# System Overview

This document proposes an application that helps young children retain attention and comprehension while watching the videos they consume daily. The application offers activities that consist of a YouTube video and quiz questions prompted throughout its duration. Children answer the questions using their voice. Parents configure how the child interacts with questions - whether the video pauses and requires an answer, allows skipping, or plays straight through. The application records and tracks each user's progress, saving data such as watch time, correctly and incorrectly answered questions, and video data.

## Conceptual Design

The system is divided into a frontend and a backend that work together to deliver an interactive, video-based learning experience designed for children.

The frontend presents YouTube videos and displays quiz questions at predefined points during playback. Children pick one of three companion characters - Blossom the Bunny, Pippa the Pig, or Ash the Alligator - each with a distinct personality and teaching style. The chosen companion influences how hints and questions are presented. The frontend provides immediate feedback, optional video rewind after incorrect answers, and displays progress in a child-friendly interface.

The backend handles all processing and data management. It stores video activities, questions, and companion configurations, evaluates user responses, determines correctness, and tracks individual user progress such as quiz results and completion history. The backend exposes APIs that allow the frontend to retrieve learning activities, submit responses, manage access codes, and securely store progress data for later review by parents.

## Background

[EdPuzzle](https://edpuzzle.com/) is a similar application. It also incorporates YouTube videos to promote learning. The website gives options to create video quizzes with multiple choice answers and even voice-recorded responses. The videos are linked and questions are added by teachers, with features to grade student responses and connect to LMS. However, Piggyback focuses on encouraging children to pay attention to everyday videos, not just educational content. Responses and grading are also done through voice detection in real time.
